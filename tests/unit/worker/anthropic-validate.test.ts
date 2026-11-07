import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChaveDaIaError,
  conferirFormatoDaChave,
  validateClaudeKey,
} from "../../../src/worker/providers/anthropic";

// Servidor HTTP local no lugar da Anthropic (ANTHROPIC_BASE_URL). Nenhum teste fala com a Anthropic.
// A resposta de cada teste é escolhida antes da chamada; o servidor conta as requisições que chegam.
type Resposta = { status: number; corpo: unknown; atrasoMs?: number };

let servidor: http.Server;
let endereco = "";
let proxima: Resposta = { status: 200, corpo: {} };
let requisicoes = 0;

const CHAVE = "sk-ant-api03-TEST-validacao-0123456789";
const mensagemOk = {
  id: "msg_teste",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text: "o" }],
  stop_reason: "max_tokens",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};
const erroDaAnthropic = (tipo: string, mensagem: string) => ({
  type: "error",
  error: { type: tipo, message: mensagem },
});

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    requisicoes++;
    req.resume();
    req.on("end", () => {
      const atual = proxima;
      setTimeout(() => {
        if (atual.atrasoMs === -1) return; // sem resposta: o cliente desiste pelo tempo limite
        res.writeHead(atual.status, { "content-type": "application/json" });
        res.end(JSON.stringify(atual.corpo));
      }, atual.atrasoMs ?? 0);
    });
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
});

beforeEach(() => {
  requisicoes = 0;
  proxima = { status: 200, corpo: mensagemOk };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function falhaCom(resposta: Resposta): Promise<ChaveDaIaError> {
  proxima = resposta;
  const erro = await validateClaudeKey(CHAVE, { ANTHROPIC_BASE_URL: endereco }).catch(
    (motivo: unknown) => motivo,
  );
  expect(erro).toBeInstanceOf(ChaveDaIaError);
  return erro as ChaveDaIaError;
}

describe("validateClaudeKey: resposta da Anthropic para a convenção", () => {
  it("200: a chave vale e não lança", async () => {
    proxima = { status: 200, corpo: mensagemOk };

    await expect(validateClaudeKey(CHAVE, { ANTHROPIC_BASE_URL: endereco })).resolves.toBeUndefined();
    expect(requisicoes).toBe(1);
  });

  it("401: chave_invalida, 400, com a mensagem da spec", async () => {
    const erro = await falhaCom({
      status: 401,
      corpo: erroDaAnthropic("authentication_error", "invalid x-api-key"),
    });

    expect(erro).toMatchObject({
      code: "chave_invalida",
      status: 400,
      message: "Chave da Anthropic inválida. Confira se copiou a chave inteira.",
    });
  });

  it("402: sem_credito, 400", async () => {
    const erro = await falhaCom({ status: 402, corpo: erroDaAnthropic("billing_error", "cobrança") });

    expect(erro).toMatchObject({
      code: "sem_credito",
      status: 400,
      message:
        "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.",
    });
  });

  it("400 com 'credit balance': sem_credito, 400", async () => {
    const erro = await falhaCom({
      status: 400,
      corpo: erroDaAnthropic("invalid_request_error", "Your credit balance is too low to access the API."),
    });

    expect(erro).toMatchObject({ code: "sem_credito", status: 400 });
  });

  it("403: sem_permissao, 400", async () => {
    const erro = await falhaCom({ status: 403, corpo: erroDaAnthropic("permission_error", "sem permissão") });

    expect(erro).toMatchObject({
      code: "sem_permissao",
      status: 400,
      message: "Essa chave não tem permissão para usar a API. Confira a chave no console da Anthropic.",
    });
  });

  it("404: modelo_indisponivel, 400", async () => {
    const erro = await falhaCom({ status: 404, corpo: erroDaAnthropic("not_found_error", "modelo") });

    expect(erro).toMatchObject({
      code: "modelo_indisponivel",
      status: 400,
      message: "Essa chave não tem acesso ao Claude Haiku 5.5, usado para categorizar.",
    });
  });

  it("429: anthropic_indisponivel, 503", async () => {
    const erro = await falhaCom({ status: 429, corpo: erroDaAnthropic("rate_limit_error", "limite") });

    expect(erro).toMatchObject({
      code: "anthropic_indisponivel",
      status: 503,
      message: "Não deu para falar com a Anthropic agora. A chave não foi salva: tente de novo em instantes.",
    });
  });

  it("529 (sobrecarga): anthropic_indisponivel, 503", async () => {
    const erro = await falhaCom({ status: 529, corpo: erroDaAnthropic("overloaded_error", "Overloaded") });

    expect(erro).toMatchObject({ code: "anthropic_indisponivel", status: 503 });
  }, 20_000);

  it("tempo esgotado (sem resposta a tempo): anthropic_indisponivel, 503", async () => {
    const erro = await falhaCom({ status: 200, corpo: mensagemOk, atrasoMs: -1 });

    expect(erro).toMatchObject({ code: "anthropic_indisponivel", status: 503 });
  }, 20_000);

  it("sem rede (nada escuta na porta): anthropic_indisponivel, 503", async () => {
    const semServidor = await validateClaudeKey(CHAVE, { ANTHROPIC_BASE_URL: "http://127.0.0.1:1" }).catch(
      (motivo: unknown) => motivo,
    );

    expect(semServidor).toMatchObject({ code: "anthropic_indisponivel", status: 503 });
  }, 20_000);
});

describe("log e mensagem nunca carregam a chave", () => {
  it("o log do erro é só { status, type }, e a chave não aparece", async () => {
    const aviso = vi.mocked(console.warn);
    await falhaCom({ status: 401, corpo: erroDaAnthropic("authentication_error", "invalid x-api-key") });

    expect(aviso).toHaveBeenCalledWith("validacao da chave da IA recusada", {
      status: 401,
      type: "authentication_error",
    });
    expect(JSON.stringify(aviso.mock.calls)).not.toContain(CHAVE);
  });

  it("o erro lançado não tem a chave na mensagem", async () => {
    const erro = await falhaCom({ status: 403, corpo: erroDaAnthropic("permission_error", CHAVE) });

    expect(erro.message).not.toContain(CHAVE);
    expect(erro.message).not.toContain("TEST");
  });
});

describe("conferirFormatoDaChave: sem chamada", () => {
  it("vazia, com espaço ou com mais de 300 caracteres: chave_formato, e o servidor não recebe nada", () => {
    for (const chave of ["", "sk-ant api", "x".repeat(301)]) {
      expect(() => conferirFormatoDaChave(chave)).toThrow(ChaveDaIaError);
      try {
        conferirFormatoDaChave(chave);
      } catch (erro) {
        expect((erro as ChaveDaIaError).code).toBe("chave_formato");
        expect((erro as ChaveDaIaError).status).toBe(400);
      }
    }
    expect(requisicoes).toBe(0);
  });

  it("uma chave comum passa sem erro", () => {
    expect(() => conferirFormatoDaChave(CHAVE)).not.toThrow();
  });
});
