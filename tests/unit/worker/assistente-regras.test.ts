import { describe, expect, it } from "vitest";
import { assistenteAtivo, podeLigarAssistente } from "../../../src/worker/setup/assistente";

// Cenário 16: com o assistente disponível no código, ele depende da chave da IA e da flag. Sem a disponibilidade, nada liga.
describe("regras do assistente", () => {
  it("podeLigarAssistente: só com a disponibilidade do código e a chave da IA", () => {
    expect(podeLigarAssistente(true, true)).toBe(true);
    expect(podeLigarAssistente(true, false)).toBe(false);
    expect(podeLigarAssistente(false, true)).toBe(false);
    expect(podeLigarAssistente(false, false)).toBe(false);
  });

  it("assistenteAtivo: exige disponibilidade, chave e flag ligada", () => {
    expect(assistenteAtivo(true, true, true)).toBe(true);
    expect(assistenteAtivo(true, true, false)).toBe(false);
    expect(assistenteAtivo(true, false, true)).toBe(false);
    expect(assistenteAtivo(false, true, true)).toBe(false);
  });
});
