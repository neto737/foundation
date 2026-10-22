import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, memberApi, type NamedItem } from "./api.js";
import { requestStorage } from "./session.js";
import {
  formatCivilDate,
  memberTextLimits,
  type Member,
  type MemberInput,
  type MemberFilters,
  type MemberPage,
  type MemberStatus,
} from "../../src/member-types.js";

const optionalFields = [
  ["birthDate", "Data de nascimento", "date"],
  ["phone", "Telefone", "tel"],
  ["email", "E-mail de contato", "email"],
  ["joinedOn", "Data de ingresso conhecida", "date"],
  ["address", "Endereço", "text"],
  ["baptismDate", "Data de batismo", "date"],
  ["churchRole", "Função na igreja", "text"],
] as const;
export function Members({
  organization,
  churches,
  path,
  navigate,
  onAccessChanged,
}: {
  organization: NamedItem;
  churches: NamedItem[];
  path: string;
  navigate(path: string): void;
  onAccessChanged(): void;
}) {
  const mode =
    path === "/membros/novo"
      ? "create"
      : path === "/membros"
        ? "list"
        : "detail";
  const [page, setPage] = useState<MemberPage | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MemberFilters>({
    page: 1,
    pageSize: 20,
  });
  const [uncertain, setUncertain] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const pending = useRef<{ key: string; input: MemberInput } | null>(null);
  const storageKey = `levi.member.request.${organization.id}`;
  const memoryKey = useRef<string | null>(null);
  function getKey() {
    try {
      const value = requestStorage()?.getItem(storageKey);
      if (value && /^[a-zA-Z0-9_-]{16,128}$/.test(value)) return value;
    } catch {
      /* Sem dados pessoais no storage. */
    }
    return memoryKey.current;
  }
  function saveKey() {
    const key = getKey() ?? crypto.randomUUID();
    memoryKey.current = key;
    try {
      requestStorage()?.setItem(storageKey, key);
    } catch {
      /* Conserva em memória. */
    }
    return key;
  }
  function clearKey() {
    memoryKey.current = null;
    try {
      requestStorage()?.removeItem(storageKey);
    } catch {
      /* Sem credenciais. */
    }
  }
  function check(organizationId: string) {
    if (organizationId !== organization.id)
      throw new ApiError(
        403,
        "CONTEXTO_ALTERADO",
        "Selecione novamente a organização para continuar.",
      );
  }
  async function validateContext() {
    const current = await api.context();
    check(current.organizationId);
    if (!current.membersEnabled)
      throw new ApiError(
        403,
        "ACESSO_NEGADO",
        "O cadastro de membros não está habilitado neste ambiente.",
      );
  }
  function fail(cause: unknown) {
    setPage(null);
    setMember(null);
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      onAccessChanged();
    else
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Não foi possível consultar os membros. Tente novamente.",
      );
  }
  async function load() {
    const sequence = ++generation.current;
    setPage(null);
    setMember(null);
    setError(null);
    setBusy(true);
    try {
      await validateContext();
      if (sequence !== generation.current) return;
      if (mode === "list") {
        const result = await memberApi.list(filters);
        check(result.organizationId);
        if (sequence === generation.current) setPage(result);
      } else if (mode === "detail") {
        const result = await memberApi.find(path.split("/")[2] ?? "");
        check(result.organizationId);
        if (sequence === generation.current) setMember(result.member);
      } else {
        const key = getKey();
        if (key) {
          try {
            const result = await memberApi.recover(key);
            check(result.organizationId);
            if (sequence === generation.current) {
              clearKey();
              navigate(`/membros/${result.memberId}`);
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404))
              throw cause;
          }
        }
      }
    } catch (cause) {
      if (sequence === generation.current) fail(cause);
    } finally {
      if (sequence === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
    // Contexto e caminho são imutáveis nesta montagem (key no componente pai).
  }, [filters]);

  async function submit(input: MemberInput) {
    if (running.current) return;
    running.current = true;
    const sequence = generation.current;
    setBusy(true);
    setError(null);
    const attempt = pending.current ?? { key: saveKey(), input };
    pending.current = attempt;
    try {
      await validateContext();
      if (sequence !== generation.current) return;
      const result = await memberApi.create(attempt.input, attempt.key);
      check(result.organizationId);
      if (sequence === generation.current) {
        clearKey();
        navigate(`/membros/${result.memberId}`);
      }
    } catch (cause) {
      if (sequence !== generation.current) return;
      if (
        cause instanceof ApiError &&
        (cause.status === 0 || cause.status >= 500 || cause.status === 409)
      )
        setUncertain(true);
      else pending.current = null;
      fail(cause);
    } finally {
      running.current = false;
      if (sequence === generation.current) setBusy(false);
    }
  }
  async function recover() {
    if (running.current) return;
    const key = getKey();
    if (!key) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const sequence = generation.current;
    try {
      await validateContext();
      const result = await memberApi.recover(key);
      check(result.organizationId);
      if (sequence === generation.current) {
        clearKey();
        navigate(`/membros/${result.memberId}`);
      }
    } catch (cause) {
      if (sequence !== generation.current) return;
      if (cause instanceof ApiError && cause.status === 404)
        setError(
          "Cadastro ainda não confirmado. Você pode repetir a mesma tentativa com segurança.",
        );
      else fail(cause);
    } finally {
      running.current = false;
      if (sequence === generation.current) setBusy(false);
    }
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({
      page: 1,
      pageSize: 20,
      name: String(data.get("name") ?? ""),
      churchId: String(data.get("churchId") ?? ""),
      ...(data.get("status")
        ? { status: data.get("status") as MemberStatus }
        : {}),
    });
  }
  return (
    <section aria-label="Gestão de membros" aria-busy={busy}>
      <p className="organization-name">{organization.nome}</p>
      <nav className="actions" aria-label="Navegação da organização">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => navigate("/igrejas")}
        >
          Igrejas
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => navigate("/organizacoes")}
        >
          Trocar organização
        </button>
        {mode !== "list" && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => navigate("/membros")}
          >
            Voltar aos membros
          </button>
        )}
      </nav>
      {busy && <p role="status">Consultando membros…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {mode === "list" && (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => navigate("/membros/novo")}
          >
            Cadastrar membro
          </button>
          <form aria-label="Filtrar membros" onSubmit={filter}>
            <fieldset disabled={busy}>
              <legend>Filtros</legend>
              <div className="field">
                <label htmlFor="member-name-filter">Nome</label>
                <input
                  id="member-name-filter"
                  name="name"
                  maxLength={160}
                  defaultValue={filters.name ?? ""}
                />
              </div>
              <div className="field">
                <label htmlFor="member-church-filter">Igreja</label>
                <select
                  id="member-church-filter"
                  name="churchId"
                  defaultValue={filters.churchId ?? ""}
                >
                  <option value="">Todas as igrejas</option>
                  {churches.map((church) => (
                    <option key={church.id} value={church.id}>
                      {church.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="member-status-filter">Situação</label>
                <select
                  id="member-status-filter"
                  name="status"
                  defaultValue={filters.status ?? ""}
                >
                  <option value="">Todas as situações</option>
                  <option>Ativo</option>
                  <option>Inativo</option>
                </select>
              </div>
              <button className="secondary" type="submit">
                Filtrar membros
              </button>
            </fieldset>
          </form>
          {page && (
            <>
              {page.members.length ? (
                <ul className="item-list">
                  {page.members.map((item) => (
                    <li key={item.id}>
                      <div className="member-summary">
                        <strong>{item.name}</strong>
                        <span>
                          {item.churchName} · {item.status}
                        </span>
                      </div>
                      <button
                        className="primary compact"
                        onClick={() => navigate(`/membros/${item.id}`)}
                        aria-label={`Consultar ${item.name}`}
                      >
                        Consultar ficha
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhum membro encontrado.</p>
              )}
              <nav className="actions" aria-label="Paginação dos membros">
                <button
                  className="secondary"
                  disabled={busy || page.page === 1}
                  onClick={() =>
                    setFilters({ ...filters, page: page.page - 1 })
                  }
                >
                  Página anterior
                </button>
                <span aria-live="polite">Página {page.page}</span>
                <button
                  className="secondary"
                  disabled={busy || !page.hasNext}
                  onClick={() =>
                    setFilters({ ...filters, page: page.page + 1 })
                  }
                >
                  Próxima página
                </button>
              </nav>
            </>
          )}
        </>
      )}
      {mode === "create" && (
        <>
          {uncertain ? (
            <div className="notice">
              <p>
                O resultado ainda não foi confirmado. Consulte o cadastro ou
                repita a mesma tentativa; os dados enviados serão preservados
                somente nesta página.
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void recover()}
                >
                  Consultar resultado
                </button>
                <button
                  className="primary"
                  disabled={busy || !pending.current}
                  onClick={() =>
                    pending.current && void submit(pending.current.input)
                  }
                >
                  Repetir mesma tentativa
                </button>
              </div>
            </div>
          ) : (
            <MemberForm busy={busy} churches={churches} onSubmit={submit} />
          )}
        </>
      )}
      {member && (
        <dl className="member-details">
          <dt>Nome</dt>
          <dd>{member.name}</dd>
          <dt>Igreja</dt>
          <dd>{member.churchName}</dd>
          <dt>Situação</dt>
          <dd>{member.status}</dd>
          {optionalFields.map(([key, label, type]) => (
            <Fragment key={key}>
              <dt>{label}</dt>
              <dd>
                {type === "date"
                  ? formatCivilDate(member[key])
                  : member[key] || "Não informado"}
              </dd>
            </Fragment>
          ))}
          <dt>Cadastrado em</dt>
          <dd>{new Date(member.createdAt).toLocaleString("pt-BR")}</dd>
        </dl>
      )}
      {error && !uncertain && mode !== "create" && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Atualizar membros
        </button>
      )}
    </section>
  );
}
function MemberForm({
  churches,
  busy,
  onSubmit,
}: {
  churches: NamedItem[];
  busy: boolean;
  onSubmit(input: MemberInput): Promise<void>;
}) {
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const input: MemberInput = {
      churchId: String(data.get("churchId") ?? ""),
      name: String(data.get("name") ?? ""),
      status: data.get("status") as MemberStatus,
    };
    for (const [key] of optionalFields)
      input[key] = String(data.get(key) ?? "").trim() || null;
    await onSubmit(input);
  }
  return (
    <form
      aria-label="Cadastrar membro"
      onSubmit={(event) => void handle(event)}
    >
      <p>
        Nome, igreja e situação são obrigatórios. Os demais campos são
        opcionais.
      </p>
      <fieldset disabled={busy}>
        <legend className="sr-only">Dados do membro</legend>
        <div className="field">
          <label htmlFor="member-name">Nome (obrigatório)</label>
          <input
            id="member-name"
            name="name"
            required
            maxLength={memberTextLimits.name}
          />
        </div>
        <div className="field">
          <label htmlFor="member-church">Igreja (obrigatória)</label>
          <select
            id="member-church"
            name="churchId"
            required
            defaultValue={churches.length === 1 ? churches[0]!.id : ""}
          >
            <option value="">Selecione uma igreja</option>
            {churches.map((church) => (
              <option key={church.id} value={church.id}>
                {church.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="member-status">Situação (obrigatória)</label>
          <select
            id="member-status"
            name="status"
            required
            defaultValue="Ativo"
          >
            <option>Ativo</option>
            <option>Inativo</option>
          </select>
        </div>
        {optionalFields.map(([key, label, type]) => (
          <div className="field" key={key}>
            <label htmlFor={`member-${key}`}>{label} (opcional)</label>
            <input
              id={`member-${key}`}
              name={key}
              type={type}
              max={type === "date" ? "9999-12-31" : undefined}
              min={type === "date" ? "0001-01-01" : undefined}
              maxLength={
                key in memberTextLimits
                  ? memberTextLimits[key as keyof typeof memberTextLimits]
                  : undefined
              }
            />
            {key === "churchRole" && (
              <p className="hint">
                A função não concede acesso administrativo.
              </p>
            )}
          </div>
        ))}
        <button className="primary" type="submit">
          {busy ? "Aguarde…" : "Salvar membro"}
        </button>
      </fieldset>
    </form>
  );
}
