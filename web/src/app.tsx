import { EmptyState, Icon, useFormFocusVisibility } from "./ui.js";
import { Members } from "./members.js";
import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type NamedItem,
  type ChurchItem,
  type ProvisionInput,
} from "./api.js";
import { AccessForm } from "./forms.js";
import { clearProvisionKey, provisionKey, requestStorage } from "./session.js";

type Screen =
  | {
      kind:
        | "loading"
        | "failure"
        | "no-access"
        | "email"
        | "login"
        | "password"
        | "organization";
    }
  | { kind: "organizations"; items: NamedItem[] }
  | {
      kind: "churches" | "dashboard";
      organization: NamedItem;
      items: ChurchItem[];
      membersEnabled: boolean;
    }
  | {
      kind: "members";
      organization: NamedItem;
      churches: NamedItem[];
      path: string;
    };
type Notice = { kind: "error" | "success" | "info"; text: string } | null;

export function App({
  link,
}: {
  link: { token: string | null; invalid: boolean };
}) {
  useFormFocusVisibility();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice>(
    link.invalid
      ? {
          kind: "error",
          text: "Este link não é válido, expirou ou já foi utilizado. Solicite uma nova mensagem para continuar.",
        }
      : null,
  );
  const [token, setToken] = useState(link.token);
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [passwordSent, setPasswordSent] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const denied = useRef(false);
  const attempt = useRef<{ key: string; input: ProvisionInput } | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const currentPath = useRef(window.location.pathname);
  function navigate(path: string) {
    currentPath.current = path;
    window.history.pushState(null, "", path);
  }
  async function refresh(resumeChurches = true): Promise<void> {
    const sequence = ++generation.current;
    setScreen({ kind: "loading" }); // Dados protegidos saem antes de consultar novamente.
    try {
      const stage = await api.stage();
      if (sequence !== generation.current) return;
      setHasSession(stage !== "email");
      if (stage === "email" || stage === "verificar-email") {
        setScreen({
          kind:
            window.location.pathname === "/entrar" && stage === "email"
              ? "login"
              : "email",
        });
        if (tokenRef.current)
          setNotice({
            kind: "info",
            text: "Verifique seu e-mail neste navegador antes de definir a senha. Depois, solicite um novo link para a senha.",
          });
        setToken(null);
        return;
      }
      if (stage === "senha" || tokenRef.current) {
        setScreen({ kind: "password" });
        return;
      }
      if (stage === "organizacao") {
        setScreen({ kind: denied.current ? "no-access" : "organization" });
        setUncertain(false);
        return;
      }
      const organizations = await api.organizations();
      if (sequence !== generation.current) return;
      clearProvisionKey(requestStorage());
      attempt.current = null;
      denied.current = false;
      setUncertain(false);
      if (
        resumeChurches &&
        (["/igrejas", "/painel"].includes(window.location.pathname) ||
          window.location.pathname.startsWith("/membros"))
      ) {
        const context = await api.context();
        const organization = organizations.find(
          (item) => item.id === context.organizationId,
        );
        if (!organization)
          throw new ApiError(
            403,
            "ACESSO_NEGADO",
            "Seu acesso precisa ser atualizado.",
          );
        const churches = await api.churches();
        if (churches.organizationId !== context.organizationId)
          throw new ApiError(
            403,
            "CONTEXTO_ALTERADO",
            "Selecione novamente a organização para continuar.",
          );
        if (
          sequence === generation.current &&
          window.location.pathname.startsWith("/membros")
        ) {
          if (!context.membersEnabled)
            throw new ApiError(
              403,
              "ACESSO_NEGADO",
              "O cadastro de membros não está habilitado neste ambiente.",
            );
          setScreen({
            kind: "members",
            organization,
            churches: churches.churches,
            path: window.location.pathname,
          });
        } else if (sequence === generation.current)
          setScreen({
            kind:
              window.location.pathname === "/painel" ? "dashboard" : "churches",
            organization,
            items: churches.churches,
            membersEnabled: context.membersEnabled,
          });
      } else setScreen({ kind: "organizations", items: organizations });
    } catch (error) {
      if (sequence !== generation.current) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403) &&
        resumeChurches
      ) {
        denied.current = true;
        setNotice({
          kind: "error",
          text: "Sua sessão ou seu acesso mudou. Confira as opções disponíveis para continuar.",
        });
        await refresh(false);
      } else {
        setScreen({ kind: "failure" });
        setNotice({
          kind: "error",
          text: "Não foi possível consultar seu acesso. Nenhuma operação será repetida automaticamente. Tente atualizar novamente.",
        });
      }
    }
  }

  useEffect(() => {
    void refresh();
    const onBack = () => {
      if (
        document.querySelector('form[data-dirty="true"]') &&
        !window.confirm(
          "Sair deste formulário? Os dados ainda não salvos serão descartados.",
        )
      ) {
        window.history.pushState(null, "", currentPath.current);
        return;
      }
      currentPath.current = window.location.pathname;
      if (!active.current) void refresh();
    };
    const onFocus = () => {
      if (document.querySelector('form[data-dirty="true"]')) {
        // Revalida sem desmontar o rascunho ao voltar do teclado ou de outro app.
        const currentScreen = screenRef.current;
        const sequence = generation.current;
        void (async () => {
          try {
            const stage = await api.stage();
            if (sequence !== generation.current) return;
            if (
              stage === "email" &&
              currentScreen.kind !== "email" &&
              currentScreen.kind !== "login"
            ) {
              await refresh(false);
              return;
            }
            if (currentScreen.kind === "members") {
              const context = await api.context();
              if (sequence !== generation.current) return;
              if (
                context.organizationId !== currentScreen.organization.id ||
                !context.membersEnabled
              )
                await refresh(false);
            }
          } catch (error) {
            if (sequence !== generation.current) return;
            if (error instanceof ApiError && [401, 403].includes(error.status))
              await refresh(false);
          }
        })();
        return;
      }
      if (
        !active.current &&
        (["/igrejas", "/painel", "/organizacoes"].includes(
          window.location.pathname,
        ) ||
          window.location.pathname.startsWith("/membros"))
      )
        void refresh();
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      ++generation.current;
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, []);
  useEffect(() => {
    if (screen.kind !== "loading") heading.current?.focus();
  }, [
    screen.kind,
    screen.kind === "members" ? screen.path : "",
    emailSent,
    passwordSent,
    Boolean(token),
  ]);

  async function perform(task: () => Promise<void>, provisioning = false) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      if (error instanceof ApiError) {
        setNotice({ kind: "error", text: error.message });
        if (error.status === 401 || error.status === 403) {
          denied.current = error.status === 403;
          await refresh(false);
        } else if (error.status === 409) {
          denied.current = true;
          await refresh(false);
          setNotice({
            kind: "info",
            text: "Seu cadastro inicial já foi concluído. Atualize suas organizações para continuar. Se não houver acesso, procure o responsável pela organização.",
          });
        } else if (error.status === 0 || error.status >= 500) {
          if (provisioning) setUncertain(true);
        }
      } else {
        setScreen({ kind: "failure" });
        setNotice({
          kind: "error",
          text: "Não foi possível confirmar a operação. Atualize seu acesso antes de continuar.",
        });
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const update = () =>
    void perform(async () => {
      await refresh();
    });

  const titles: Record<Screen["kind"], string> = {
    loading: "Consultando seu acesso",
    failure: "Vamos tentar novamente",
    "no-access": "Seu acesso precisa de atenção",
    email: emailSent
      ? "Confira sua caixa de entrada"
      : "Comece pelo seu e-mail",
    login: "Bem-vindo de volta",
    password: token
      ? "Escolha sua senha"
      : passwordSent
        ? "O segundo e-mail está a caminho"
        : "E-mail verificado. Agora, sua senha.",
    organization: "Um lugar para sua comunidade",
    organizations: "Suas organizações",
    dashboard: "Visão geral",
    churches: "Igrejas da organização",
    members:
      screen.kind === "members" && screen.path.endsWith("/editar")
        ? "Editar membro"
        : screen.kind === "members" && screen.path === "/membros/novo"
          ? "Cadastrar membro"
          : screen.kind === "members" && screen.path !== "/membros"
            ? "Ficha do membro"
            : "Membros",
  };
  const step =
    screen.kind === "email" || screen.kind === "login"
      ? 0
      : screen.kind === "password"
        ? 1
        : 2;
  const showSteps = ["email", "login", "password", "organization"].includes(
    screen.kind,
  );
  const administrative = [
    "dashboard",
    "churches",
    "members",
    "organizations",
  ].includes(screen.kind);
  const currentOrganization =
    screen.kind === "churches" ||
    screen.kind === "dashboard" ||
    screen.kind === "members"
      ? screen.organization
      : null;
  const membersEnabled =
    screen.kind === "members" ||
    ((screen.kind === "churches" || screen.kind === "dashboard") &&
      screen.membersEnabled);
  function go(path: string, success?: string) {
    if (
      !success &&
      document.querySelector('form[data-dirty="true"]') &&
      !window.confirm(
        "Sair deste formulário? Os dados ainda não salvos serão descartados.",
      )
    )
      return;
    navigate(path);
    void perform(async () => {
      await refresh();
      if (success) setNotice({ kind: "success", text: success });
    });
  }
  const navigation = currentOrganization && (
    <nav aria-label="Navegação da organização" className="admin-nav">
      {(
        [
          { path: "/painel", label: "Início", icon: "home" },
          { path: "/igrejas", label: "Igrejas", icon: "church" },
          ...(membersEnabled
            ? [{ path: "/membros", label: "Membros", icon: "people" }]
            : []),
        ] as const
      ).map((item) => (
        <button
          key={item.path}
          disabled={busy}
          aria-current={
            (screen.kind === "dashboard" && item.path === "/painel") ||
            (screen.kind === "churches" && item.path === "/igrejas") ||
            (screen.kind === "members" && item.path === "/membros")
              ? "page"
              : undefined
          }
          onClick={() => go(item.path)}
        >
          <Icon name={item.icon as "home" | "church" | "people"} />
          {item.label}
        </button>
      ))}
      <button
        className="organization-switch"
        disabled={busy}
        onClick={() => go("/organizacoes")}
      >
        <span aria-hidden="true">⇄</span>Trocar organização
      </button>
    </nav>
  );
  return (
    <div className={`app ${administrative ? "admin-app" : "access-app"}`}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            go(currentOrganization ? "/painel" : "/");
          }}
          aria-label="Levi, início"
        >
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span>
            Levi<small>Gestão de igrejas</small>
          </span>
        </a>
        {currentOrganization && (
          <div className="context-label">
            <span className="eyebrow">Organização ativa</span>
            <strong>{currentOrganization.nome}</strong>
            <span className="context-role">Administração</span>
          </div>
        )}
        {hasSession && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                if (
                  document.querySelector('form[data-dirty="true"]') &&
                  !window.confirm(
                    "Sair da conta? Os dados ainda não salvos serão descartados.",
                  )
                )
                  return;
                setScreen({ kind: "loading" });
                await api.logout();
                setToken(null);
                clearProvisionKey(requestStorage());
                attempt.current = null;
                denied.current = false;
                setEmailSent(false);
                setPasswordSent(false);
                navigate("/");
                await refresh(false);
              })
            }
          >
            Sair
          </button>
        )}
      </header>
      {administrative && currentOrganization && (
        <aside className="sidebar">
          <p className="nav-caption">ESPAÇO DE GESTÃO</p>
          {navigation}
          <div className="sidebar-note">
            <span className="context-role">Acesso administrativo</span>
            <p>
              Um espaço para organizar
              <br />e cuidar das pessoas.
            </p>
          </div>
        </aside>
      )}
      <div className={`workspace ${showSteps ? "with-steps" : ""}`}>
        {showSteps && (
          <aside className="journey" aria-label="Etapas para começar">
            <p className="eyebrow">Seu primeiro acesso</p>
            <h2>
              Cuidado com as pessoas.
              <br />
              Clareza na gestão.
            </h2>
            <p>
              Vamos preparar seu acesso e o espaço da sua organização, uma etapa
              de cada vez.
            </p>
            <ol>
              {[
                "Verifique seu e-mail",
                "Defina sua senha",
                "Organize sua primeira igreja",
              ].map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <p className="journey-note">
              Neste processo, você recebe dois e-mails: um para verificar seu
              acesso e outro para definir a senha.
            </p>
          </aside>
        )}
        <main
          id="conteudo"
          className={`panel ${administrative ? "admin-panel" : "access-panel"}`}
          aria-busy={busy || screen.kind === "loading"}
        >
          <p className="eyebrow">
            {screen.kind === "churches"
              ? "Sua organização"
              : showSteps
                ? "Vamos começar"
                : "Seu espaço no Levi"}
          </p>
          {showSteps && <p className="step-caption">Etapa {step + 1} de 3</p>}
          <h1 ref={heading} tabIndex={-1}>
            {titles[screen.kind]}
          </h1>
          <div aria-live="polite" aria-atomic="true">
            {busy || screen.kind === "loading" ? (
              <p className="loading" role="status">
                Aguarde, estamos consultando o Levi…
              </p>
            ) : null}
          </div>
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </div>
          )}

          {screen.kind === "email" && (
            <>
              {emailSent ? (
                <>
                  <p>
                    Use o link recebido para verificar seu e-mail e continuar.
                    Se não encontrar a mensagem, confira também o spam.
                    Solicitações repetidas podem ser limitadas; aguarde antes de
                    pedir outro link.
                  </p>
                  <p>
                    Depois da verificação, você vai solicitar um segundo e-mail
                    para definir sua senha.
                  </p>
                  <button className="primary" disabled={busy} onClick={update}>
                    Já abri o link. Continuar
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setEmailSent(false)}
                  >
                    Solicitar outro link
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Informe seu e-mail para receber um link de acesso. Você
                    ainda não precisa de senha.
                  </p>
                  <AccessForm
                    mode="email"
                    busy={busy}
                    onSubmit={(values) =>
                      perform(async () => {
                        await api.email(values.email!.trim());
                        setEmailSent(true);
                      })
                    }
                  />
                </>
              )}
              <p className="secondary-action">
                Já definiu sua senha?{" "}
                <a
                  href="/entrar"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/entrar");
                    update();
                  }}
                >
                  Entrar na minha conta
                </a>
              </p>
            </>
          )}
          {screen.kind === "login" && (
            <>
              <p>Entre com o e-mail e a senha que você já definiu.</p>
              <AccessForm
                mode="login"
                busy={busy}
                onSubmit={(values) =>
                  perform(async () => {
                    await api.login(values.email!.trim(), values.password!);
                    denied.current = false;
                    navigate("/organizacoes");
                    await refresh(false);
                  })
                }
              />
              <p className="secondary-action">
                Primeiro acesso ou precisa de um link?{" "}
                <a
                  href="/"
                  onClick={(event) => {
                    event.preventDefault();
                    setEmailSent(false);
                    navigate("/");
                    update();
                  }}
                >
                  Continuar por e-mail
                </a>
              </p>
            </>
          )}
          {screen.kind === "password" && (
            <>
              {token ? (
                <>
                  <p>
                    Defina e confirme sua senha para concluir a preparação da
                    sua conta.
                  </p>
                  <AccessForm
                    mode="password"
                    busy={busy}
                    onSubmit={(values) =>
                      perform(async () => {
                        try {
                          await api.password(token, values.newPassword!);
                        } catch (error) {
                          setToken(null);
                          tokenRef.current = null;
                          setPasswordSent(false);
                          await refresh(false);
                          throw error;
                        }
                        setToken(null);
                        tokenRef.current = null;
                        await refresh(false);
                        setNotice({
                          kind: "success",
                          text: "Senha definida. Sua conta está pronta para continuar.",
                        });
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <p>
                    {passwordSent
                      ? "Abra o link desta segunda mensagem neste navegador para escolher sua senha. Confira também o spam."
                      : "O primeiro link confirmou seu e-mail. Agora vamos enviar uma segunda mensagem, com o link para você escolher sua senha."}
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.passwordEmail();
                        setPasswordSent(true);
                      })
                    }
                  >
                    {passwordSent
                      ? "Enviar outro link para definir senha"
                      : "Receber e-mail para definir senha"}
                  </button>
                  <p className="hint">
                    Por segurança, se você atualizar a página depois de abrir o
                    link de senha, solicite uma nova mensagem. Não guardamos o
                    link no navegador.
                  </p>
                </>
              )}
            </>
          )}
          {screen.kind === "organization" && (
            <>
              <p>
                Sua conta está pronta. Crie a organização e a primeira igreja
                que você vai administrar.
              </p>
              {uncertain ? (
                <>
                  <p>
                    Não sabemos se a solicitação foi concluída. Confira o
                    resultado antes de reenviar; manteremos a mesma tentativa.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await refresh(false);
                      })
                    }
                  >
                    Verificar resultado
                  </button>
                </>
              ) : (
                <AccessForm
                  key="organization"
                  mode="organization"
                  busy={busy}
                  initial={attempt.current?.input}
                  onSubmit={(values) =>
                    perform(async () => {
                      const input = {
                        organizationName: values.organizationName!.trim(),
                        churchName: values.churchName!.trim(),
                        churchAddress: values.churchAddress?.trim() || null,
                        churchPhone: values.churchPhone?.trim() || null,
                        churchEmail: values.churchEmail?.trim() || null,
                      };
                      const key =
                        attempt.current?.key ?? provisionKey(requestStorage());
                      attempt.current = { key, input };
                      await api.provision(input, key);
                      navigate("/organizacoes");
                      await refresh(false);
                    }, true)
                  }
                />
              )}
            </>
          )}
          {screen.kind === "organizations" && (
            <>
              <p>
                Escolha a organização que deseja acessar. Seu vínculo é
                conferido a cada acesso.
              </p>
              {screen.items.length ? (
                <ul className="item-list">
                  {screen.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <span className="item-symbol" aria-hidden="true">
                          O
                        </span>
                        <strong>{item.nome}</strong>
                      </div>
                      <button
                        className="primary compact"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            setScreen({ kind: "loading" });
                            await api.select(item.id);
                            navigate("/igrejas");
                            await refresh();
                          })
                        }
                        aria-label={`Acessar ${item.nome}`}
                      >
                        Acessar organização <span aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Nenhuma organização está disponível com vínculo administrativo
                  atual. Procure o responsável pela organização.
                </p>
              )}
              <button className="text-button" disabled={busy} onClick={update}>
                Atualizar organizações
              </button>
            </>
          )}
          {screen.kind === "members" && (
            <Members
              key={`${screen.organization.id}:${screen.path}`}
              organization={screen.organization}
              churches={screen.churches}
              path={screen.path}
              navigate={go}
              onAccessChanged={() => {
                denied.current = true;
                void refresh(false);
              }}
            />
          )}
          {screen.kind === "dashboard" && (
            <>
              <div className="welcome surface">
                <div>
                  <p className="eyebrow">Sua comunidade, mais próxima</p>
                  <h2>
                    Um bom começo para
                    <br />
                    cuidar de cada pessoa.
                  </h2>
                  <p>
                    Organize os cadastros e encontre as informações que precisa
                    no dia a dia.
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      go(membersEnabled ? "/membros/novo" : "/igrejas")
                    }
                  >
                    <Icon name="plus" />
                    {membersEnabled ? "Cadastrar membro" : "Consultar igrejas"}
                  </button>
                </div>
                <div className="welcome-mark" aria-hidden="true">
                  <Icon name="people" />
                </div>
              </div>
              <div className="overview-grid">
                <div className="surface overview-card">
                  <span className="tile-icon">
                    <Icon name="church" />
                  </span>
                  <p>Igrejas na organização</p>
                  <strong className="metric">{screen.items.length}</strong>
                  <button
                    className="text-button"
                    onClick={() => go("/igrejas")}
                  >
                    Consultar igrejas →
                  </button>
                </div>
                <div className="surface overview-card">
                  <span className="tile-icon">
                    <Icon name="people" />
                  </span>
                  <h2>Gestão de membros</h2>
                  <p>
                    {membersEnabled
                      ? "Cadastros organizados, contatos e informações sempre à mão."
                      : "Este recurso ainda não está disponível para esta organização."}
                  </p>
                  {membersEnabled && (
                    <button
                      className="text-button"
                      onClick={() => go("/membros")}
                    >
                      Consultar membros →
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {screen.kind === "churches" && (
            <>
              <div className="page-intro">
                <p>As igrejas que fazem parte da sua organização.</p>
                <span className="count-label">
                  {screen.items.length}{" "}
                  {screen.items.length === 1 ? "igreja" : "igrejas"}
                </span>
              </div>
              {screen.items.length ? (
                <ul className="church-grid">
                  {screen.items.map((item) => (
                    <li className="surface church-card" key={item.id}>
                      <span className="tile-icon">
                        <Icon name="church" />
                      </span>
                      <div>
                        <span className="eyebrow">Igreja</span>
                        <h2>{item.nome}</h2>
                      </div>
                      <dl>
                        <dt>Endereço</dt>
                        <dd>{item.address || "Não informado"}</dd>
                        <dt>Telefone</dt>
                        <dd>{item.phone || "Não informado"}</dd>
                        <dt>E-mail</dt>
                        <dd>{item.email || "Não informado"}</dd>
                      </dl>
                      {membersEnabled && (
                        <button
                          className="secondary"
                          onClick={() => go("/membros")}
                        >
                          Consultar membros <Icon name="arrow" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nenhuma igreja disponível nesta organização." />
              )}
              <button className="text-button" disabled={busy} onClick={update}>
                Atualizar igrejas
              </button>
            </>
          )}
          {(screen.kind === "failure" || screen.kind === "no-access") && (
            <>
              <p>
                {screen.kind === "no-access"
                  ? "Não há acesso administrativo disponível neste momento. Atualize para verificar novamente ou procure o responsável pela organização."
                  : "Confira sua conexão e tente consultar seu acesso novamente."}
              </p>
              <button className="primary" disabled={busy} onClick={update}>
                Atualizar acesso
              </button>
            </>
          )}
        </main>
      </div>
      <footer className={administrative ? "admin-footer" : ""}>
        Levi <span aria-hidden="true">·</span> Um espaço para organizar e
        cuidar.
      </footer>
    </div>
  );
}
