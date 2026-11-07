import { describe, expect, it } from "vitest";
import {
  ChaveMestraAusenteError,
  chaveMestraValida,
  decryptSecret,
  encryptSecret,
} from "../../../src/worker/security/crypto";

// Chaves mestras falsas e fixas, só destes testes: 32 bytes em base64.
const MESTRA = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const OUTRA_MESTRA = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const TEXTO = "sk-ant-api03-TEST-cifra-0123456789";

describe("cifra AES-GCM das chaves", () => {
  it("ida e volta: o texto decifrado é o original, e o cifrado não contém o texto", async () => {
    const segredo = await encryptSecret(MESTRA, "claude_api_key", TEXTO);

    expect(segredo.ciphertext).not.toContain(TEXTO);
    expect(await decryptSecret(MESTRA, "claude_api_key", segredo)).toBe(TEXTO);
  });

  it("IV novo a cada gravação: o mesmo texto cifra de outra forma", async () => {
    const primeira = await encryptSecret(MESTRA, "claude_api_key", TEXTO);
    const segunda = await encryptSecret(MESTRA, "claude_api_key", TEXTO);

    expect(primeira.iv).not.toBe(segunda.iv);
    expect(primeira.ciphertext).not.toBe(segunda.ciphertext);
  });

  it("o IV tem 12 bytes", async () => {
    const { iv } = await encryptSecret(MESTRA, "claude_api_key", TEXTO);

    expect(Buffer.from(iv, "base64").length).toBe(12);
  });

  it("additionalData é o nome: uma linha copiada para outro nome não abre", async () => {
    const segredo = await encryptSecret(MESTRA, "claude_api_key", TEXTO);

    await expect(decryptSecret(MESTRA, "google_tts_key", segredo)).rejects.toThrow();
  });

  it("chave mestra errada não abre a linha", async () => {
    const segredo = await encryptSecret(MESTRA, "claude_api_key", TEXTO);

    await expect(decryptSecret(OUTRA_MESTRA, "claude_api_key", segredo)).rejects.toThrow();
  });

  it("linha adulterada não abre", async () => {
    const segredo = await encryptSecret(MESTRA, "claude_api_key", TEXTO);
    const bytes = Buffer.from(segredo.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    await expect(
      decryptSecret(MESTRA, "claude_api_key", { ...segredo, ciphertext: bytes.toString("base64") }),
    ).rejects.toThrow();
  });

  it("chave mestra ausente, vazia ou com tamanho errado: erro tipado, antes de qualquer cifra", async () => {
    for (const mestra of [undefined, "", "abc", btoa("curta")]) {
      const erro = await encryptSecret(mestra, "claude_api_key", TEXTO).catch((motivo: unknown) => motivo);
      expect(erro, String(mestra)).toBeInstanceOf(ChaveMestraAusenteError);
    }
  });

  it("chaveMestraValida só aceita base64 de 32 bytes", () => {
    expect(chaveMestraValida(MESTRA)).toBe(true);
    expect(chaveMestraValida(undefined)).toBe(false);
    expect(chaveMestraValida("abc")).toBe(false);
    expect(chaveMestraValida(btoa("x".repeat(31)))).toBe(false);
  });
});
