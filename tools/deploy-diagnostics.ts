import assert from "node:assert/strict";

const phases = {
  configuration: "configuração",
  ci: "CI aprovada do SHA atual",
  protections: "proteções remotas",
  bundle: "preparação do bundle",
  publish: "publicação Wrangler",
  published: "verificação após publicação",
  cleanup: "limpeza privada",
} as const;

const checks = {
  configuration: "contexto e configuração DEV",
  "main-read": "consulta da main remota",
  "main-sha": "SHA da main remota",
  "local-head": "SHA do checkout local",
  "local-clean": "checkout sem alterações",
  "ci-context": "contexto da execução CI",
  "ci-workflow-read": "consulta do workflow CI",
  "ci-workflow": "identidade do workflow CI",
  "ci-event": "evento e tentativa da CI acionadora",
  "ci-runs-read": "consulta das execuções CI do SHA",
  "ci-runs": "execução CI disponível para o SHA",
  "ci-run-id": "identificador da execução CI",
  "ci-run-read": "consulta da execução CI",
  "ci-run": "identidade e aprovação da execução CI",
  "ci-attempt": "tentativa atual da CI",
  "ci-jobs-read": "consulta dos jobs da CI",
  "ci-jobs-shape": "estrutura da lista de jobs CI",
  "ci-job": "job checks aprovado no SHA",
  "ci-unchanged": "evidência CI inalterada antes do upload",
  "hyperdrive-read": "consulta do Hyperdrive",
  hyperdrive: "origem e cache do Hyperdrive",
  "subdomain-read": "consulta de workers.dev e previews",
  subdomain: "workers.dev e previews desabilitados",
  "domains-read": "consulta dos custom domains",
  "domains-shape": "estrutura da lista de custom domains",
  domains: "custom domains exclusivos do Levi",
  "zone-id": "formato do identificador da zona",
  "zone-read": "consulta da zona Cloudflare",
  zone: "identidade da zona e conta",
  "routes-read": "consulta das rotas da zona",
  "routes-shape": "estrutura da lista de rotas",
  routes: "ausência de rotas alternativas do Levi",
  "pagination-limit": "limite de paginação das listas Cloudflare",
  "bundle-read": "leitura da configuração Wrangler",
  "bundle-parse": "formato da configuração Wrangler",
  "bundle-config": "proteções da configuração de publicação",
  "bundle-directory": "preparação do diretório privado",
  "bundle-files": "gravação dos arquivos privados de publicação",
  wrangler: "publicação pelo Wrangler",
  "deployments-read": "consulta dos deployments do Worker",
  "deployment-shape": "estrutura das versões do deployment",
  "deployment-traffic": "versão única com 100% do tráfego",
  "version-read": "consulta da versão ativa",
  "version-tag": "tag da versão ativa igual ao SHA",
  "home-read": "requisição da página inicial",
  "home-response": "status e cabeçalhos da página inicial",
  "onboarding-read": "requisição do onboarding anônimo",
  "onboarding-response": "status e cabeçalhos do onboarding anônimo",
  "onboarding-body": "estado anônimo do onboarding",
  "organizations-read": "requisição anônima de organizações",
  "organizations-response": "bloqueio anônimo e cabeçalhos de organizações",
  "churches-read": "requisição anônima de igrejas",
  "churches-response": "bloqueio anônimo e cabeçalhos de igrejas",
  cleanup: "remoção dos arquivos privados temporários",
} as const;

export type DeployCheck = keyof typeof checks;
type Category =
  | "divergência de configuração"
  | "resposta inesperada"
  | "falha HTTP"
  | "erro de rede"
  | "falha de operação local";

// Só códigos técnicos conhecidos podem sair do processo. Nunca serializar o erro.
const safeCauses = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOSPC",
]);

export class DeployDiagnostics {
  phase: keyof typeof phases = "configuration";
  private check: DeployCheck = "configuration";
  private category: Category = "divergência de configuração";
  private status: number | undefined;

  constructor(
    private readonly progress: (message: string) => void = () => {},
  ) {}

  start(
    check: DeployCheck,
    category: Category = "divergência de configuração",
    status?: number,
  ) {
    this.check = check;
    this.category = category;
    this.status = status;
    this.progress(
      `Deploy DEV: etapa: ${phases[this.phase]}; verificação: ${checks[check]}.`,
    );
  }

  verify<T>(check: DeployCheck, operation: () => T): T {
    this.inspect(check);
    return operation();
  }

  // Valida os dados da resposta atual, mantendo seu status para o diagnóstico.
  // Operações independentes usam start(), que limpa esse contexto HTTP.
  inspect(
    check: DeployCheck,
    category: Category = "divergência de configuração",
  ) {
    this.start(check, category, this.status);
  }

  async request(check: DeployCheck, operation: () => Promise<Response>) {
    this.start(check, "erro de rede");
    const response = await operation();
    this.status = response.status;
    this.category = "resposta inesperada";
    return response;
  }

  httpOk(response: Response) {
    this.category = "falha HTTP";
    assert.ok(response.ok);
    this.category = "resposta inesperada";
  }

  httpStatus(response: Response, expected: number) {
    this.category = "falha HTTP";
    assert.equal(response.status, expected);
    this.category = "resposta inesperada";
  }

  message(error: unknown) {
    let category = this.category;
    if (
      category !== "erro de rede" &&
      (error instanceof SyntaxError || error instanceof TypeError)
    )
      category = "resposta inesperada";
    const candidate = error as {
      code?: unknown;
      cause?: { code?: unknown };
    } | null;
    const code = candidate?.code ?? candidate?.cause?.code;
    const cause =
      typeof code === "string" && safeCauses.has(code)
        ? code
        : category === "erro de rede" &&
            error instanceof Error &&
            error.name === "TimeoutError"
          ? "timeout"
          : "não detalhada";
    return `Deploy DEV não confirmado na etapa: ${phases[this.phase]}; verificação: ${checks[this.check]}; categoria: ${category}; status HTTP: ${this.status ?? "indisponível"}; causa técnica: ${cause}. Nenhuma repetição ou contratação automática. Confira o estado remoto antes de tentar novamente.`;
  }
}
