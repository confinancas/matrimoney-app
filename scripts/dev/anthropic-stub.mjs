#!/usr/bin/env node
// Stub da Anthropic para o E2E (TASK-0102): responde POST /v1/messages com as respostas que a validação da chave trata.
// Nenhuma chave real passa por aqui. Só as chaves de teste (sk-ant-api03-TEST-…) têm resposta; as outras levam 401.
import http from "node:http";

const porta = Number(process.env.MM_E2E_PORTA_DO_STUB ?? 8789);

const mensagemOk = {
  id: "msg_e2e",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text: "o" }],
  stop_reason: "max_tokens",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

function respostaPara(chave) {
  if (chave?.startsWith("sk-ant-api03-TEST-valida")) return { status: 200, corpo: mensagemOk };
  if (chave === "sk-ant-api03-TEST-semcredito") {
    return {
      status: 400,
      corpo: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API.",
        },
      },
    };
  }
  if (chave === "sk-ant-api03-TEST-fora") {
    return {
      status: 529,
      corpo: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    };
  }
  return {
    status: 401,
    corpo: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
  };
}

const servidor = http.createServer((requisicao, resposta) => {
  requisicao.resume();
  requisicao.on("end", () => {
    if (requisicao.method !== "POST" || requisicao.url !== "/v1/messages") {
      resposta.writeHead(404, { "content-type": "application/json" });
      resposta.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "rota" } }));
      return;
    }
    // O SDK 1.6 manda a chave como Authorization: Bearer (e não x-api-key): o stub aceita as duas formas.
    const bearer = requisicao.headers.authorization?.replace(/^Bearer /, "");
    const { status, corpo } = respostaPara(requisicao.headers["x-api-key"] ?? bearer);
    resposta.writeHead(status, { "content-type": "application/json" });
    resposta.end(JSON.stringify(corpo));
  });
});

servidor.listen(porta, "127.0.0.1", () => {
  console.log(`anthropic-stub ouvindo em 127.0.0.1:${porta}`);
});
