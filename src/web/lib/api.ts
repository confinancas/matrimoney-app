import { type ApiErrorBody, isApiErrorBody } from "../../shared/api";

const MENSAGEM_PADRAO = "Algo deu errado. Tente de novo.";

export const CAMINHO_DA_CONFIGURACAO = "/configuracao-inicial";

// Sem configuração pronta, a API responde 503 configuracao_pendente: o app vai para a configuração inicial.
// Não redireciona de dentro dela (a própria tela chama a API). Os testes trocam a ação.
let levaParaConfiguracao = (): void => {
  if (window.location.pathname !== CAMINHO_DA_CONFIGURACAO) window.location.replace(CAMINHO_DA_CONFIGURACAO);
};

// Devolve a ação anterior, para o teste restaurar.
export function definirAcaoDaConfiguracaoPendente(acao: () => void): () => void {
  const anterior = levaParaConfiguracao;
  levaParaConfiguracao = acao;
  return () => {
    levaParaConfiguracao = anterior;
  };
}

// Falha da API: status (0 quando não houve resposta), código da convenção e mensagem para a tela.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// Mensagem para a tela: a da convenção quando é uma falha da API; a padrão para qualquer outra coisa.
export function mensagemDoErro(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : MENSAGEM_PADRAO;
}

// Envio com corpo JSON (PUT e POST). O corpo nunca é gravado em estado: quem chama descarta o valor depois.
export function apiEnviar<T>(caminho: string, metodo: "POST" | "PUT", corpo: unknown): Promise<T> {
  return apiFetch<T>(caminho, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

// Chamada à API do mesmo site: cookies da mesma origem, JSON. Não mostra detalhe técnico: a mensagem é da convenção.
export async function apiFetch<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const cabecalhos = new Headers(init.headers);
  if (!cabecalhos.has("accept")) cabecalhos.set("accept", "application/json");

  let resposta: Response;
  try {
    resposta = await fetch(caminho, { ...init, credentials: "same-origin", headers: cabecalhos });
  } catch {
    throw new ApiError(0, "sem_conexao", "Sem conexão.");
  }

  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    if (isApiErrorBody(corpo)) {
      const erro: ApiErrorBody = corpo;
      if (resposta.status === 503 && erro.error === "configuracao_pendente") levaParaConfiguracao();
      throw new ApiError(resposta.status, erro.error, erro.message ?? MENSAGEM_PADRAO, erro.fields);
    }
    throw new ApiError(resposta.status, "erro_http", MENSAGEM_PADRAO);
  }

  // 204 não tem corpo: o resultado é undefined, e não um erro de JSON (correção herdada da TASK-0005).
  if (resposta.status === 204) return undefined as T;

  return (await resposta.json()) as T;
}
