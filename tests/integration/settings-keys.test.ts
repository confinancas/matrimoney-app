import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturesResponse, KeysResponse } from "../../src/shared/setup";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import { ChaveDaIaError, type ValidacaoDaChave } from "../../src/worker/providers/anthropic";
import { saveSecret, secretStatus } from "../../src/worker/security/secrets";
import { callApi, semearPronto } from "./helpers/app";

const db = createDb(env.DB, newMeter());
// Chave mestra diferente da do teste: as linhas gravadas com ela não abrem na instalação de teste.
const OUTRA_MESTRA = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const AMBIENTE_COM_OUTRA_MESTRA = { ...env, MASTER_KEY: OUTRA_MESTRA } as typeof env;

// Chave falsa do teste: nenhum teste fala com a Anthropic.
const CHAVE = "sk-ant-api03-TEST-valida-0123456789";
const OUTRA_CHAVE = "sk-ant-api03-TEST-nova-abcdefghijk";
const CHAVE_VALIDA_OK: ValidacaoDaChave = async () => undefined;
const recusa =
  (codigo: ChaveDaIaError["code"], status: 400 | 503, mensagem: string): ValidacaoDaChave =>
  async () => {
    throw new ChaveDaIaError(codigo, status, mensagem);
  };
const SEM_MESTRA = { ...env, MASTER_KEY: "" } as typeof env;
const MENSAGEM_DE_CREDITO =
  "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.";

const criarApp = (validateClaudeKey: ValidacaoDaChave = CHAVE_VALIDA_OK) => createApp({ validateClaudeKey });

beforeEach(async () => {
  await semearPronto(env.DB);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/features", () => {
  it("sem chave: tudo desligado, com a forma {ia, assistente, voz}", async () => {
    const resposta = await callApi(criarApp(), "GET", "/api/features");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual<FeaturesResponse>({ ia: false, assistente: false, voz: false });
  });

  it("com a chave da IA salva: ia verdadeiro; o assistente segue desligado (ASSISTANT_AVAILABLE falso)", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const corpo = (await (await callApi(app, "GET", "/api/features")).json()) as FeaturesResponse;
    expect(corpo).toEqual({ ia: true, assistente: false, voz: false });
  });
});

describe("GET /api/settings/keys", () => {
  it("sem chaves: cada uma sem configurar, sem máscara", async () => {
    const resposta = await callApi(criarApp(), "GET", "/api/settings/keys");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual<KeysResponse>({
      claude: { configured: false, masked: null, readable: false },
      google: { configured: false, masked: null, readable: false },
    });
  });

  it("com a chave: só a versão mascarada, nunca a chave inteira", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const texto = await (await callApi(app, "GET", "/api/settings/keys")).text();
    expect(JSON.parse(texto)).toEqual({
      claude: { configured: true, masked: "sk-ant-…6789", readable: true },
      google: { configured: false, masked: null, readable: false },
    });
    expect(texto).not.toContain(CHAVE);
  });

  it("sem a chave mestra: 500 chave_mestra_ausente", async () => {
    const resposta = await callApi(criarApp(), "GET", "/api/settings/keys", undefined, {}, SEM_MESTRA);

    expect(resposta.status).toBe(500);
    expect(((await resposta.json()) as { error: string }).error).toBe("chave_mestra_ausente");
  });

  it("cenário 15: linha cifrada com outra chave mestra aparece como 'Não abre mais'", async () => {
    await saveSecret(db, AMBIENTE_COM_OUTRA_MESTRA, "claude_api_key", CHAVE);

    const corpo = (await (await callApi(criarApp(), "GET", "/api/settings/keys")).json()) as KeysResponse;
    expect(corpo.claude).toEqual({ configured: true, masked: null, readable: false });
  });
});

describe("PUT /api/settings/keys/claude", () => {
  it("cola a primeira chave: 200 com o mascarado, e vale na hora para o status", async () => {
    const app = criarApp();
    const resposta = await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      claude: { configured: true, masked: "sk-ant-…6789", readable: true },
    });
    expect(await secretStatus(db, env, "claude_api_key")).toMatchObject({ readable: true });
  });

  it("troca a chave: o mascarado muda", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });
    const troca = await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: OUTRA_CHAVE });

    expect(await troca.json()).toEqual({
      claude: { configured: true, masked: "sk-ant-…hijk", readable: true },
    });
  });

  it("cenário 14: chave recusada: a mensagem do mapa, e a chave antiga continua valendo", async () => {
    await callApi(criarApp(), "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const recusada = await callApi(
      criarApp(recusa("sem_credito", 400, MENSAGEM_DE_CREDITO)),
      "PUT",
      "/api/settings/keys/claude",
      { apiKey: OUTRA_CHAVE },
    );

    expect(recusada.status).toBe(400);
    expect(await recusada.json()).toEqual({ error: "sem_credito", message: MENSAGEM_DE_CREDITO });
    const status = (await (await callApi(criarApp(), "GET", "/api/settings/keys")).json()) as KeysResponse;
    expect(status.claude.masked).toBe("sk-ant-…6789");
  });

  it("cenário 19: colar a chave depois apaga a flag 'sem IA'", async () => {
    const app = criarApp();
    await env.DB.prepare("INSERT INTO feature_flags (name, enabled) VALUES ('sem_ia', 1)").run();

    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const flag = await env.DB.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE name = 'sem_ia'").first<{
      n: number;
    }>();
    expect(flag?.n).toBe(0);
  });

  it("cenário 15: trocar a chave resolve a linha que não abria", async () => {
    await saveSecret(db, AMBIENTE_COM_OUTRA_MESTRA, "claude_api_key", CHAVE);

    const resposta = await callApi(criarApp(), "PUT", "/api/settings/keys/claude", { apiKey: OUTRA_CHAVE });

    expect(resposta.status).toBe(200);
    expect(await secretStatus(db, env, "claude_api_key")).toEqual({
      configured: true,
      masked: "sk-ant-…hijk",
      readable: true,
    });
  });

  it("sem apiKey texto: 400 dados_invalidos, sem chamar a validação", async () => {
    const validar = vi.fn(CHAVE_VALIDA_OK);
    const resposta = await callApi(criarApp(validar), "PUT", "/api/settings/keys/claude", { apiKey: 42 });

    expect(resposta.status).toBe(400);
    expect(((await resposta.json()) as { error: string }).error).toBe("dados_invalidos");
    expect(validar).not.toHaveBeenCalled();
  });

  it("sem a chave mestra: 500 chave_mestra_ausente e nada gravado", async () => {
    const resposta = await callApi(
      criarApp(),
      "PUT",
      "/api/settings/keys/claude",
      { apiKey: CHAVE },
      {},
      SEM_MESTRA,
    );

    expect(resposta.status).toBe(500);
    expect(((await resposta.json()) as { error: string }).error).toBe("chave_mestra_ausente");
    const linhas = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_secrets").first<{ n: number }>();
    expect(linhas?.n).toBe(0);
  });
});

describe("PUT /api/features/assistente", () => {
  it("com ASSISTANT_AVAILABLE falso, mesmo com chave: 409 assistente_indisponivel", async () => {
    const app = criarApp();
    await callApi(app, "PUT", "/api/settings/keys/claude", { apiKey: CHAVE });

    const resposta = await callApi(app, "PUT", "/api/features/assistente", { enabled: true });

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      error: "assistente_indisponivel",
      message: "O assistente não está disponível nesta instalação.",
    });
  });

  it("sem chave da IA: 409 assistente_indisponivel", async () => {
    const resposta = await callApi(criarApp(), "PUT", "/api/features/assistente", { enabled: true });

    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as { error: string }).error).toBe("assistente_indisponivel");
  });

  it("corpo sem enabled booleano: 400 dados_invalidos", async () => {
    const resposta = await callApi(criarApp(), "PUT", "/api/features/assistente", { enabled: "sim" });

    expect(resposta.status).toBe(400);
    expect(((await resposta.json()) as { error: string }).error).toBe("dados_invalidos");
  });
});
