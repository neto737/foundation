import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  new URL(databaseUrl).hostname !== "127.0.0.1" ||
  new URL(databaseUrl).pathname !== "/levi_test"
)
  throw new Error("Use o harness PostgreSQL descartável.");

test("proteção UPDATE: migration incremental e roles restritas em PostgreSQL descartável", async (t) => {
  const admin = await createPostgresDatabase(databaseUrl);
  const connections: Awaited<ReturnType<typeof createPostgresDatabase>>[] = [];
  const roles: string[] = [];
  const database = "levi_update_guard_test";
  const password = "synthetic-update-guard-only";
  const directory = await mkdtemp(join(tmpdir(), "levi-update-guard-"));
  let databaseCreated = false;
  try {
    for (const role of [
      "levi_dev_migrator",
      "levi_dev_runtime",
      "levi_guard_operator",
    ]) {
      // Nomes constantes; roles exclusivas do cluster recém-criado pelo harness.
      await admin.client.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
      );
      roles.push(role);
    }
    await admin.client.query(
      `CREATE DATABASE ${database} OWNER levi_dev_migrator`,
    );
    databaseCreated = true;
    async function connect(role: string) {
      const url = new URL(databaseUrl!);
      url.pathname = `/${database}`;
      url.username = role;
      url.password = password;
      const connection = await createPostgresDatabase(url.toString());
      connections.push(connection);
      assert.equal(
        (await connection.client.query("SELECT current_user")).rows[0]
          .current_user,
        role,
      );
      return connection;
    }
    const owner = await connect("levi_dev_migrator");
    const runtime = await connect("levi_dev_runtime");
    const operator = await connect("levi_guard_operator");
    const journal = JSON.parse(
      await readFile("migrations/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string; when: number }[] };
    assert.equal(
      journal.entries.findIndex(
        (entry) => entry.tag === "0003_protecao-update-runtime",
      ),
      3,
    );
    await mkdir(join(directory, "meta"));
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }),
    );
    for (const entry of journal.entries.slice(0, 3))
      await cp(
        `migrations/${entry.tag}.sql`,
        join(directory, `${entry.tag}.sql`),
      );
    await migrate(owner.db, { migrationsFolder: directory });
    const journalBefore = (
      await owner.client.query(
        "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    assert.equal(journalBefore.length, 3);
    const tenant = (
      await owner.client.query(
        "INSERT INTO tenants(name) VALUES('Organização sintética de locks') RETURNING id",
      )
    ).rows[0].id as string;
    const user = (
      await owner.client.query(
        `INSERT INTO "user"(name,email) VALUES('Conta sintética','update-guard@example.test') RETURNING id`,
      )
    ).rows[0].id as string;
    const church = (
      await owner.client.query(
        "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja sintética de locks') RETURNING id",
        [tenant],
      )
    ).rows[0].id as string;
    const membership = (
      await owner.client.query(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin') RETURNING id",
        [tenant, user],
      )
    ).rows[0].id as string;
    const tables = [
      {
        name: "churches",
        id: church,
        trigger: "churches_reject_dev_runtime_update",
      },
      {
        name: "tenant_memberships",
        id: membership,
        trigger: "tenant_memberships_reject_dev_runtime_update",
      },
    ];
    async function records() {
      return Promise.all(
        tables.map(
          async ({ name, id }) =>
            (
              await owner.client.query(
                `SELECT * FROM public.${name} WHERE id=$1`,
                [id],
              )
            ).rows,
        ),
      );
    }
    const before = await records();
    await cp(
      "migrations/0003_protecao-update-runtime.sql",
      join(directory, "0003_protecao-update-runtime.sql"),
    );
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 4) }),
    );
    await migrate(owner.db, { migrationsFolder: directory });

    await t.test(
      "0003 preserva dados/journal anteriores, ownership e reaplicação é inócua",
      async () => {
        assert.deepEqual(await records(), before);
        const after = (
          await owner.client.query(
            "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
          )
        ).rows;
        assert.deepEqual(after.slice(0, 3), journalBefore);
        assert.equal(after.length, 4);
        assert.equal(after[3].created_at, String(journal.entries[3]!.when));
        assert.equal(
          after[3].hash,
          createHash("sha256")
            .update(
              await readFile("migrations/0003_protecao-update-runtime.sql"),
            )
            .digest("hex"),
        );
        await migrate(owner.db, { migrationsFolder: directory });
        assert.deepEqual(
          (
            await owner.client.query(
              "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
            )
          ).rows,
          after,
        );
        const definition = (
          await owner.client.query(`
          SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner,
                 pg_get_userbyid(p.proowner) AS function_owner,
                 t.tgtype, t.tgenabled, p.prosecdef, p.proconfig
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_proc p ON p.oid=t.tgfoid
          WHERE p.oid='public.reject_dev_runtime_update()'::regprocedure
          ORDER BY c.relname
        `)
        ).rows;
        assert.equal(definition.length, 2);
        for (const row of definition) {
          assert.equal(row.table_owner, "levi_dev_migrator");
          assert.equal(row.function_owner, "levi_dev_migrator");
          assert.equal(row.tgtype, 18); // BEFORE(2) + UPDATE(16), sem ROW(1).
          assert.equal(row.tgenabled, "O");
          assert.equal(row.prosecdef, false);
          assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
        }
        for (const { name } of tables)
          assert.equal(
            (
              await runtime.client.query(
                "SELECT has_any_column_privilege(current_user,$1,'UPDATE') AS allowed",
                [`public.${name}`],
              )
            ).rows[0].allowed,
            false,
          );
      },
    );

    // Somente fixtures descartáveis: não faz parte da migration ou de grants DEV.
    for (const { name } of tables) {
      await owner.client.query(
        `GRANT SELECT ON TABLE public.${name} TO levi_dev_runtime, levi_guard_operator`,
      );
      await assert.rejects(
        runtime.client.query(`SELECT * FROM public.${name} FOR SHARE`),
        { code: "42501" },
      );
      await owner.client.query(
        `GRANT UPDATE(created_at) ON TABLE public.${name} TO levi_dev_runtime, levi_guard_operator`,
      );
    }

    await t.test(
      "FOR SHARE funciona com UPDATE apenas em created_at e bloqueia escritor concorrente",
      async () => {
        for (const { name, id } of tables) {
          assert.deepEqual(
            (
              await runtime.client.query(
                `
            SELECT attname FROM pg_attribute
            WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped
              AND has_column_privilege(current_user,attrelid,attnum,'UPDATE')
          `,
                [`public.${name}`],
              )
            ).rows.map((row) => row.attname),
            ["created_at"],
          );
          assert.equal(
            (
              await runtime.client.query(
                "SELECT has_table_privilege(current_user,$1,'UPDATE') AS allowed",
                [`public.${name}`],
              )
            ).rows[0].allowed,
            false,
          );
          await runtime.client.query("BEGIN");
          try {
            assert.equal(
              (
                await runtime.client.query(
                  `SELECT * FROM public.${name} WHERE id=$1 FOR SHARE`,
                  [id],
                )
              ).rowCount,
              1,
            );
            await owner.client.query("BEGIN");
            try {
              // NOWAIT comprova o conflito imediatamente, sem sleeps/timeouts.
              await assert.rejects(
                owner.client.query(
                  `SELECT id FROM public.${name} WHERE id=$1 FOR UPDATE NOWAIT`,
                  [id],
                ),
                { code: "55P03" },
              );
            } finally {
              await owner.client.query("ROLLBACK");
            }
          } finally {
            await runtime.client.query("ROLLBACK");
          }
        }
      },
    );

    await t.test(
      "UPDATE real, no-op e sem linhas são rejeitados pelo trigger sem alterar registros",
      async () => {
        for (const { name, id } of tables) {
          for (const [set, target] of [
            ["'2001-01-01'::timestamptz", id],
            ["created_at", id],
            ["'2001-01-01'::timestamptz", randomUUID()],
          ])
            await assert.rejects(
              runtime.client.query(
                `UPDATE public.${name} SET created_at=${set} WHERE id=$1`,
                [target],
              ),
              {
                code: "42501",
                message: "A runtime DEV não pode atualizar estes registros",
              },
            );
          await assert.rejects(
            runtime.client.query(
              `UPDATE public.${name} SET created_at=now() WHERE false`,
            ),
            {
              code: "42501",
              message: "A runtime DEV não pode atualizar estes registros",
            },
          );
        }
        assert.deepEqual(await records(), before);
        await assert.rejects(
          runtime.client.query(
            "UPDATE churches SET name='Outro nome' WHERE id=$1",
            [church],
          ),
          { code: "42501" },
        );
        await assert.rejects(
          runtime.client.query(
            "UPDATE tenant_memberships SET role='unknown' WHERE id=$1",
            [membership],
          ),
          { code: "42501" },
        );
      },
    );

    await t.test(
      "runtime sem ownership não altera, remove ou desativa triggers/função nem assume owner",
      async () => {
        for (const { name, trigger } of tables)
          for (const sql of [
            `ALTER TABLE public.${name} DISABLE TRIGGER ${trigger}`,
            `ALTER TABLE public.${name} DISABLE TRIGGER USER`,
            `ALTER TRIGGER ${trigger} ON public.${name} RENAME TO bypass_update_guard`,
            `DROP TRIGGER ${trigger} ON public.${name}`,
            `CREATE TRIGGER bypass_update_guard BEFORE UPDATE ON public.${name} FOR EACH STATEMENT EXECUTE FUNCTION public.reject_dev_runtime_update()`,
          ])
            await assert.rejects(runtime.client.query(sql), { code: "42501" });
        for (const sql of [
          "ALTER FUNCTION public.reject_dev_runtime_update() SECURITY DEFINER",
          "DROP FUNCTION public.reject_dev_runtime_update() CASCADE",
          "CREATE OR REPLACE FUNCTION public.reject_dev_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$",
          "SET session_replication_role = replica",
          "SET ROLE levi_dev_migrator",
          "SET ROLE levi_guard_operator",
        ])
          await assert.rejects(runtime.client.query(sql), { code: "42501" });
        assert.deepEqual(await records(), before);
        for (const { name } of tables)
          await assert.rejects(
            runtime.client.query(
              `UPDATE public.${name} SET created_at=now() WHERE false`,
            ),
            {
              code: "42501",
              message: "A runtime DEV não pode atualizar estes registros",
            },
          );
      },
    );

    await t.test(
      "migradora e operador autorizado continuam atualizando; INSERT legítimo não é bloqueado",
      async () => {
        for (const { name, id } of tables) {
          assert.equal(
            (
              await operator.client.query(
                `UPDATE public.${name} SET created_at='2002-01-01' WHERE id=$1`,
                [id],
              )
            ).rowCount,
            1,
          );
          assert.equal(
            (
              await owner.client.query(
                `UPDATE public.${name} SET created_at='2003-01-01' WHERE id=$1`,
                [id],
              )
            ).rowCount,
            1,
          );
          assert.equal(
            (
              await operator.client.query(
                `UPDATE public.${name} SET created_at=now() WHERE false`,
              )
            ).rowCount,
            0,
          );
          assert.equal(
            (
              await owner.client.query(
                `SELECT created_at::text FROM public.${name} WHERE id=$1`,
                [id],
              )
            ).rows[0].created_at,
            "2003-01-01 00:00:00+00",
          );
        }
        assert.equal(
          (
            await owner.client.query(
              "UPDATE churches SET name='Igreja sintética atualizada' WHERE id=$1",
              [church],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await owner.client.query(
              "UPDATE tenant_memberships SET role='unknown' WHERE id=$1",
              [membership],
            )
          ).rowCount,
          1,
        );
        await owner.client.query(
          "GRANT INSERT(tenant_id,name) ON public.churches TO levi_dev_runtime",
        );
        assert.equal(
          (
            await runtime.client.query(
              "INSERT INTO churches(tenant_id,name) VALUES($1,'Nova igreja sintética')",
              [tenant],
            )
          ).rowCount,
          1,
        );
        await owner.client.query(
          "GRANT INSERT(tenant_id,user_id,role) ON public.tenant_memberships TO levi_dev_runtime",
        );
        const otherTenant = (
          await owner.client.query(
            "INSERT INTO tenants(name) VALUES('Outra organização sintética') RETURNING id",
          )
        ).rows[0].id;
        assert.equal(
          (
            await runtime.client.query(
              "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
              [otherTenant, user],
            )
          ).rowCount,
          1,
        );
      },
    );
    await t.test(
      "0004 preserva fichas existentes, inicializa versão e mantém histórico pessoal eliminável",
      async () => {
        const row = (
          await owner.client.query(
            "INSERT INTO members(tenant_id,church_id,name,status,phone) VALUES($1,$2,'Perfil anterior','Ativo','Contato anterior') RETURNING *",
            [tenant, church],
          )
        ).rows[0];
        await cp(
          "migrations/0004_interface-e-edicao.sql",
          join(directory, "0004_interface-e-edicao.sql"),
        );
        await writeFile(
          join(directory, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) }),
        );
        await migrate(owner.db, { migrationsFolder: directory });
        await migrate(owner.db, { migrationsFolder: directory });
        const upgraded = (
          await owner.client.query("SELECT * FROM members WHERE id=$1", [
            row.id,
          ])
        ).rows[0];
        const { version, ...preserved } = upgraded;
        assert.equal(version, 1);
        assert.deepEqual(preserved, row);
        const churchContacts = (
          await owner.client.query(
            "SELECT address,phone,email FROM churches WHERE id=$1",
            [church],
          )
        ).rows[0];
        assert.deepEqual(churchContacts, {
          address: null,
          phone: null,
          email: null,
        });
        await owner.client.query(
          "INSERT INTO member_profile_history(tenant_id,member_id,actor_id,version,previous_profile) VALUES($1,$2,$3,1,$4)",
          [tenant, row.id, user, { name: row.name, phone: row.phone }],
        );
        await assert.rejects(
          owner.client.query(
            "INSERT INTO member_profile_history(tenant_id,member_id,actor_id,version,previous_profile) VALUES($1,$2,$3,2,'{}')",
            [randomUUID(), row.id, user],
          ),
          { code: "23503" },
        );
        await owner.client.query("DELETE FROM members WHERE id=$1", [row.id]);
        assert.equal(
          (
            await owner.client.query(
              "SELECT count(*)::int n FROM member_profile_history WHERE member_id=$1",
              [row.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
  } finally {
    for (const connection of connections.reverse())
      await connection.client.end();
    try {
      if (databaseCreated)
        await admin.client.query(`DROP DATABASE ${database}`);
      for (const role of roles.reverse())
        await admin.client.query(`DROP ROLE ${role}`);
    } finally {
      await admin.client.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
