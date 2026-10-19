import { useEffect, useRef, useState } from "react";
import { api, ApiError, type NamedItem, type ProvisionInput } from "./api.js";
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
  | { kind: "churches"; organization: NamedItem; items: NamedItem[] };
type Notice = { kind: "error" | "success" | "info"; text: string } | null;

export function App({
  link,
}: {
  link: { token: string | null; invalid: boolean };
}) {
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

  function navigate(path: string) {
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
      if (resumeChurches && window.location.pathname === "/igrejas") {
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
        if (sequence === generation.current)
          setScreen({
            kind: "churches",
            organization,
            items: churches.churches,
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
      if (!active.current) void refresh();
    };
    const onFocus = () => {
      if (
        !active.current &&
        ["/igrejas", "/organizacoes"].includes(window.location.pathname)
      )
        void refresh();
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onBack);
    return () => {
      ++generation.current;
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onBack);
    };
  }, []);
  useEffect(() => {
    if (screen.kind !== "loading") heading.current?.focus();
  }, [screen.kind, emailSent, passwordSent, Boolean(token)]);

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
          else await refresh(false);
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
    churches: "Igrejas da organização",
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
  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
            update();
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
        {hasSession && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
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
          className="panel"
          aria-busy={busy || screen.kind === "loading"}
        >
          <p className="eyebrow">
            {screen.kind === "churches"
              ? "Sua organização"
              : showSteps
                ? "Vamos começar"
                : "Seu espaço no Levi"}
          </p>
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
                  mode="organization"
                  busy={busy}
                  initial={attempt.current?.input}
                  onSubmit={(values) =>
                    perform(async () => {
                      const input = {
                        organizationName: values.organizationName!.trim(),
                        churchName: values.churchName!.trim(),
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
          {screen.kind === "churches" && (
            <>
              <p className="organization-name">{screen.organization.nome}</p>
              <p>
                Estas são as igrejas disponíveis na organização selecionada.
              </p>
              {screen.items.length ? (
                <ul className="item-list churches">
                  {screen.items.map((item) => (
                    <li key={item.id}>
                      <span className="item-symbol" aria-hidden="true">
                        I
                      </span>
                      <strong>{item.nome}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhuma igreja disponível nesta organização.</p>
              )}
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    navigate("/organizacoes");
                    update();
                  }}
                >
                  Trocar organização
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={update}
                >
                  Atualizar igrejas
                </button>
              </div>
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
      <footer>
        Levi <span aria-hidden="true">·</span> Um espaço para organizar e
        cuidar.
      </footer>
    </div>
  );
}
