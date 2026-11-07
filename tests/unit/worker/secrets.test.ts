import { describe, expect, it } from "vitest";
import { maskKey } from "../../../src/worker/security/mascara";

// readSecret e saveSecret usam o D1 e estão em tests/integration/secrets.test.ts.
describe("maskKey", () => {
  it("com 4 caracteres: reticências e os 2 últimos", () => {
    expect(maskKey("abcd")).toBe("…cd");
  });

  it("com 15 caracteres: ainda na regra curta (…, os 2 últimos)", () => {
    const chave = `${"x".repeat(13)}YZ`;
    expect(chave).toHaveLength(15);
    expect(maskKey(chave)).toBe("…YZ");
  });

  it("com 16 caracteres: os 7 primeiros, reticências e os 4 últimos", () => {
    const chave = "sk-ant-api0-abcd";
    expect(chave).toHaveLength(16);
    expect(maskKey(chave)).toBe("sk-ant-…abcd");
  });

  it("com 108 caracteres: os 7 primeiros, reticências e os 4 últimos", () => {
    const chave = `sk-ant-${"a".repeat(97)}x7Fq`;
    expect(chave).toHaveLength(108);
    expect(maskKey(chave)).toBe("sk-ant-…x7Fq");
  });

  it("nunca devolve a chave inteira", () => {
    for (const tamanho of [4, 15, 16, 108]) {
      const chave = "k".repeat(tamanho);
      expect(maskKey(chave)).not.toBe(chave);
    }
  });
});
