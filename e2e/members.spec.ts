import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { randomUUID } from "node:crypto";
import { readyAccount, provision } from "./helpers.js";
const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  new URL(databaseUrl).hostname !== "127.0.0.1" ||
  new URL(databaseUrl).pathname !== "/levi_test"
)
  throw new Error("Use a suíte sintética de navegador.");
const observer = await createPostgresDatabase(databaseUrl);
test.afterAll(async () => {
  await observer.client.end();
});
test.use({ timezoneId: "Pacific/Kiritimati" });
async function openMembers(page: Page) {
  const email = await readyAccount(page);
  await provision(page, "Organização sintética de pessoas");
  await page
    .getByRole("button", {
      name: "Acessar Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Nenhum membro encontrado.", { exact: true }),
  ).toBeVisible();
  const user = (
    await observer.client.query('SELECT id FROM "user" WHERE email=$1', [email])
  ).rows[0];
  const tenant = (
    await observer.client.query(
      "SELECT tenant_id FROM tenant_memberships WHERE user_id=$1",
      [user.id],
    )
  ).rows[0];
  const church = (
    await observer.client.query("SELECT id FROM churches WHERE tenant_id=$1", [
      tenant.tenant_id,
    ])
  ).rows[0];
  return {
    email,
    userId: user.id as string,
    organizationId: tenant.tenant_id as string,
    churchId: church.id as string,
  };
}
async function startCreate(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Cadastrar membro", exact: true })
    .click();
  await expect(
    page.getByLabel("Situação (obrigatória)", { exact: true }),
  ).toHaveValue("Ativo");
  await page.getByLabel("Nome (obrigatório)", { exact: true }).fill(name);
}

test("membros: cadastro completo, ficha com datas civis, filtros e acessibilidade móvel", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa sintética completa");
  await page.getByLabel("Nome (obrigatório)", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Igreja (obrigatória)", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Situação (obrigatória)", { exact: true })
    .selectOption("Inativo");
  await page
    .getByLabel("Data de nascimento (opcional)", { exact: true })
    .fill("2000-02-29");
  await page
    .getByLabel("Telefone (opcional)", { exact: true })
    .fill("+55 11 0000-0000");
  await page
    .getByLabel("E-mail de contato (opcional)", { exact: true })
    .fill("contato@example.test");
  await page
    .getByLabel("Data de ingresso conhecida (opcional)", { exact: true })
    .fill("2020-01-01");
  await page
    .getByLabel("Endereço (opcional)", { exact: true })
    .fill("Endereço sintético");
  await page
    .getByLabel("Data de batismo (opcional)", { exact: true })
    .fill("2021-03-01");
  await page
    .getByLabel("Função na igreja (opcional)", { exact: true })
    .fill("Função sintética");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  for (const value of [
    "Pessoa sintética completa",
    "29/02/2000",
    "01/01/2020",
    "01/03/2021",
    "contato@example.test",
    "Inativo",
  ])
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByText("Pessoa sintética completa", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Voltar aos membros", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("não existe");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByText("Nenhum membro encontrado.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("sintética");
  await page.getByLabel("Situação", { exact: true }).selectOption("Ativo");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByText("Nenhum membro encontrado.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Situação", { exact: true }).selectOption("Inativo");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Consultar Pessoa sintética completa",
      exact: true,
    }),
  ).toBeVisible();
});

test("membros: cadastro mínimo, paginação e nenhuma persistência pessoal no navegador", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa mínima sintética");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa mínima sintética", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Não informado", { exact: true })).toHaveCount(7);
  for (let index = 0; index < 20; index++) {
    const response = await page.request.post("/api/members", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        name: `Pessoa sintética ${String(index).padStart(2, "0")}`,
        churchId: who.churchId,
        status: "Ativo",
      },
    });
    expect(response.status()).toBe(201);
  }
  await page
    .getByRole("button", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Consultar Pessoa/ }),
  ).toHaveCount(20);
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Consultar Pessoa/ }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Página anterior", exact: true })
    .click();
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  );
  expect(storage).not.toContain("Pessoa");
  expect(storage).not.toContain("example.test");
});

test("membros: resposta perdida após commit é recuperada no refresh sem duplicação", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa com resposta perdida");
  let key: string | undefined;
  await page.route("**/api/members", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    key = route.request().headers()["idempotency-key"];
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Consultar resultado", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.stringify(Object.entries(sessionStorage)),
  );
  expect(stored).toContain(key!);
  expect(stored).not.toContain("Pessoa");
  await page.unroute("**/api/members");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa com resposta perdida", { exact: true }),
  ).toBeVisible();
  const count = (
    await observer.client.query(
      "SELECT count(*)::int AS count FROM members WHERE tenant_id=$1",
      [who.organizationId],
    )
  ).rows[0].count;
  expect(count).toBe(1);
});

test("membros: troca organizacional e revogação removem ficha e listagem anteriores", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa da primeira organização");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toBeVisible();
  const tenant = (
    await observer.client.query(
      "INSERT INTO tenants(name) VALUES('Outra organização de pessoas') RETURNING id",
    )
  ).rows[0];
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Outra igreja de pessoas')",
    [tenant.id],
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [tenant.id, who.userId],
  );
  await page
    .getByRole("button", { name: "Trocar organização", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Acessar Outra organização de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Nenhum membro encontrado.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toHaveCount(0);
  await startCreate(page, "Pessoa da segunda organização");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da segunda organização", { exact: true }),
  ).toBeVisible();
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id, who.userId],
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa da segunda organização", { exact: true }),
  ).toHaveCount(0);
});

test("membros: resposta de tenant divergente e perda de sessão não mantêm dados protegidos", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa protegida sintética");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/members?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, organizationId: randomUUID() },
    });
  });
  await page
    .getByRole("button", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/members?*");
  await page
    .getByRole("button", {
      name: "Acessar Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toHaveCount(0);
});

test("membros: capacidade desabilitada remove dados e navegação e impede abertura direta", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa sintética com acesso removido");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toBeVisible();
  // Teste do contrato visual: a política real por organização é exercitada em workerd.
  await page.route("**/api/context", async (route) => {
    const response = await route.fetch();
    const context = await response.json();
    await route.fulfill({
      response,
      json: { ...context, membersEnabled: false },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Acessar Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Trocar organização", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Membros", exact: true }),
  ).toHaveCount(0);
  await page.goto("/membros");
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cadastrar membro", exact: true }),
  ).toHaveCount(0);
});
