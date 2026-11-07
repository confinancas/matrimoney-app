// Validação da chave da IA (TASK-0102): uma chamada mínima ao modelo da categorização, que confere a chave,
// o crédito e o acesso ao modelo de uma vez. Só o servidor fala com a Anthropic (ADR-003).
import Anthropic, { APIConnectionError, APIError } from "@anthropic-ai/sdk";

export const MODELO_DA_CATEGORIZACAO = "claude-haiku-5-5";
const TAMANHO_MAXIMO_DA_CHAVE = 300;
const TEMPO_LIMITE_MS = 10_000;

export type CodigoDaChave =
  | "chave_formato"
  | "chave_invalida"
  | "sem_credito"
  | "sem_permissao"
  | "modelo_indisponivel"
  | "anthropic_indisponivel";

// O erro leva o código, o status HTTP e a mensagem para a tela. Nunca leva a chave.
export class ChaveDaIaError extends Error {
  readonly code: CodigoDaChave;
  readonly status: 400 | 503;

  constructor(code: CodigoDaChave, status: 400 | 503, message: string) {
    super(message);
    this.name = "ChaveDaIaError";
    this.code = code;
    this.status = status;
  }
}

export type ValidacaoDaChave = (apiKey: string, env: { ANTHROPIC_BASE_URL?: string }) => Promise<void>;

// Formato antes de qualquer chamada: vazia, com espaço ou longa demais são recusadas sem falar com ninguém.
export function conferirFormatoDaChave(apiKey: string): void {
  if (apiKey.length === 0 || /\s/.test(apiKey) || apiKey.length > TAMANHO_MAXIMO_DA_CHAVE) {
    throw new ChaveDaIaError(
      "chave_formato",
      400,
      "A chave não tem o formato esperado. Confira se copiou a chave inteira, sem espaços.",
    );
  }
}

const MENSAGENS: Record<Exclude<CodigoDaChave, "chave_formato">, { status: 400 | 503; texto: string }> = {
  chave_invalida: {
    status: 400,
    texto: "Chave da Anthropic inválida. Confira se copiou a chave inteira.",
  },
  sem_credito: {
    status: 400,
    texto:
      "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.",
  },
  sem_permissao: {
    status: 400,
    texto: "Essa chave não tem permissão para usar a API. Confira a chave no console da Anthropic.",
  },
  modelo_indisponivel: {
    status: 400,
    texto: "Essa chave não tem acesso ao Claude Haiku 5.5, usado para categorizar.",
  },
  anthropic_indisponivel: {
    status: 503,
    texto: "Não deu para falar com a Anthropic agora. A chave não foi salva: tente de novo em instantes.",
  },
};

function codigoDoErro(erro: unknown): {
  code: Exclude<CodigoDaChave, "chave_formato">;
  status: number | null;
  type: string;
} {
  if (erro instanceof APIConnectionError) {
    return { code: "anthropic_indisponivel", status: null, type: erro.name };
  }
  if (erro instanceof APIError) {
    const status = erro.status ?? null;
    const type = erro.type ?? "api";
    const mensagem = erro.apiMessage ?? erro.message;
    if (status === 401) return { code: "chave_invalida", status, type };
    if (status === 402 || type === "billing_error" || (status === 400 && /credit balance/i.test(mensagem))) {
      return { code: "sem_credito", status, type };
    }
    if (status === 403) return { code: "sem_permissao", status, type };
    if (status === 404) return { code: "modelo_indisponivel", status, type };
    return { code: "anthropic_indisponivel", status, type };
  }
  return { code: "anthropic_indisponivel", status: null, type: "desconhecido" };
}

// Traduz o erro do SDK para o código da convenção. O log leva só { status, type }.
export function traduzirErroDaAnthropic(erro: unknown): ChaveDaIaError {
  const { code, status, type } = codigoDoErro(erro);
  console.warn("validacao da chave da IA recusada", { status, type });
  const { status: httpStatus, texto } = MENSAGENS[code];
  return new ChaveDaIaError(code, httpStatus, texto);
}

export const validateClaudeKey: ValidacaoDaChave = async (apiKey, env) => {
  const cliente = new Anthropic({
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL,
    maxRetries: 0,
    timeout: TEMPO_LIMITE_MS,
  });
  try {
    await cliente.messages.create({
      model: MODELO_DA_CATEGORIZACAO,
      max_tokens: 1,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "ok" }],
    });
  } catch (erro) {
    throw traduzirErroDaAnthropic(erro);
  }
};
