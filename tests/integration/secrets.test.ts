import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import { readSecret, saveSecret, secretStatus } from "../../src/worker/security/secrets";

const db = createDb(env.DB, newMeter());
const OUTRA_MESTRA = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const AMBIENTE_COM_OUTRA_MESTRA = { ...env, MASTER_KEY: OUTRA_MESTRA } as typeof env;
const CHAVE = "sk-ant-api03-TEST-segredo-0123456789";

const linhaDoSegredo = (nome: string) =>
  env.DB.prepare("SELECT name, ciphertext, iv, updated_at FROM app_secrets WHERE name = ?")
    .bind(nome)
    .first<{ name: string; ciphertext: string; iv: string; updated_at: string }>();

describe("readSecret", () => {
  it("ausente: sem linha, sem erro", async () => {
    expect(await readSecret(db, env, "claude_api_key")).toEqual({ status: "ausente" });
  });

  it("ok: devolve o valor decifrado, e a linha não guarda a chave em texto", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);

    expect(await readSecret(db, env, "claude_api_key")).toEqual({ status: "ok", value: CHAVE });
    const linha = await linhaDoSegredo("claude_api_key");
    expect(linha?.ciphertext).not.toContain(CHAVE);
    expect(JSON.stringify(linha)).not.toContain(CHAVE);
  });

  it("ilegivel: a chave mestra trocada não abre a linha, e readSecret não lança", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);

    await expect(readSecret(db, AMBIENTE_COM_OUTRA_MESTRA, "claude_api_key")).resolves.toEqual({
      status: "ilegivel",
    });
  });

  it("ilegivel: sem chave mestra nenhuma, readSecret devolve ilegivel em vez de lançar", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);

    await expect(readSecret(db, { ...env, MASTER_KEY: "" } as typeof env, "claude_api_key")).resolves.toEqual(
      { status: "ilegivel" },
    );
  });

  it("ilegivel: uma linha copiada para outro nome não abre (additionalData é o nome)", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);
    const original = await linhaDoSegredo("claude_api_key");
    await env.DB.prepare("INSERT INTO app_secrets (name, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?)")
      .bind("google_tts_key", original?.ciphertext, original?.iv, original?.updated_at)
      .run();

    expect(await readSecret(db, env, "google_tts_key")).toEqual({ status: "ilegivel" });
  });

  it("ilegivel: uma linha adulterada não abre", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);
    await env.DB.prepare("UPDATE app_secrets SET ciphertext = ? WHERE name = 'claude_api_key'")
      .bind("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      .run();

    expect(await readSecret(db, env, "claude_api_key")).toEqual({ status: "ilegivel" });
  });
});

describe("saveSecret", () => {
  it("cada gravação usa um IV novo, e a segunda substitui a primeira (uma linha só)", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);
    const primeira = await linhaDoSegredo("claude_api_key");
    await saveSecret(db, env, "claude_api_key", CHAVE);
    const segunda = await linhaDoSegredo("claude_api_key");

    expect(segunda?.iv).not.toBe(primeira?.iv);
    expect(segunda?.updated_at).toBeTruthy();
    const contagem = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_secrets").first<{ n: number }>();
    expect(contagem?.n).toBe(1);
  });

  it("a chave nova substitui a antiga: readSecret devolve a nova", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);
    await saveSecret(db, env, "claude_api_key", "sk-ant-api03-TEST-outra-9876543210");

    expect(await readSecret(db, env, "claude_api_key")).toEqual({
      status: "ok",
      value: "sk-ant-api03-TEST-outra-9876543210",
    });
  });
});

describe("secretStatus", () => {
  it("mascara a chave lida e nunca devolve o valor", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);

    const status = await secretStatus(db, env, "claude_api_key");
    expect(status).toEqual({ configured: true, masked: "sk-ant-…6789", readable: true });
    expect(JSON.stringify(status)).not.toContain(CHAVE);
  });

  it("ilegível: configurada, sem máscara, não abre", async () => {
    await saveSecret(db, env, "claude_api_key", CHAVE);

    expect(await secretStatus(db, AMBIENTE_COM_OUTRA_MESTRA, "claude_api_key")).toEqual({
      configured: true,
      masked: null,
      readable: false,
    });
  });
});
