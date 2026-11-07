import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { FeaturesResponse } from "../../src/shared/setup";
import { createApp } from "../../src/worker/app";
import { callApi, semearPronto } from "./helpers/app";

// Com ASSISTANT_AVAILABLE falso (MVP), o assistente fica desligado mesmo com chave e com a flag gravada.
// A regra com a disponibilidade ligada é testada como função pura (tests/unit/worker/assistente-regras.test.ts).
const CHAVE = "sk-ant-api03-TEST-assistente-0123456789";
const criarApp = () => createApp({ validateClaudeKey: async () => undefined });

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("assistente desligado no MVP", () => {
  it("sem chave da IA, ligar o assistente responde 409 assistente_indisponivel", async () => {
    const resposta = await callApi(criarApp(), "PUT", "/api/features/assistente", { enabled: true });

    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as { error: string }).error).toBe("assistente_indisponivel");
  });

  it("com chave, ainda assim 409: a disponibilidade vem do código", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const resposta = await callApi(app, "PUT", "/api/features/assistente", { enabled: true });

    expect(resposta.status).toBe(409);
    expect(await (await callApi(app, "GET", "/api/features")).json()).toEqual<FeaturesResponse>({
      ia: true,
      assistente: false,
      voz: false,
    });
  });

  it("a flag gravada no banco não liga o assistente se o código não o disponibiliza", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });
    await env.DB.prepare("INSERT INTO feature_flags (name, enabled) VALUES ('assistente', 1)").run();

    const corpo = (await (await callApi(app, "GET", "/api/features")).json()) as FeaturesResponse;
    expect(corpo.assistente).toBe(false);
  });
});
