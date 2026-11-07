import { describe, expect, it } from "vitest";
import {
  chaveVazia,
  mergeRuleSets,
  RULE_SCOPES,
  type RuleSet,
  ruleScopeForMovement,
  SCOPE_MOVEMENTS,
} from "../../src/shared/rule-match";

const TODOS_OS_MOVIMENTOS = [
  "compra",
  "estorno",
  "pix_enviado",
  "pix_recebido",
  "ted_enviada",
  "ted_recebida",
  "pagamento_fatura",
  "transferencia_interna",
  "rendimento",
  "debito",
  "boleto",
  "outro",
];

const VAZIA: RuleSet = {
  setCustomName: null,
  setCategoryId: null,
  setSpendType: null,
  setIncomeKind: null,
  setIncomeSubtype: null,
  setFixedIncomeId: null,
  setMovement: null,
};

describe("ruleScopeForMovement", () => {
  it("cada movimento do modelo tem o escopo da spec, ou nenhum", () => {
    const esperado: Record<string, string | null> = {
      compra: "estabelecimento",
      estorno: "estabelecimento",
      debito: "estabelecimento",
      boleto: "estabelecimento",
      pix_enviado: "destinatario",
      ted_enviada: "destinatario",
      pix_recebido: "remetente",
      ted_recebida: "remetente",
      pagamento_fatura: null,
      transferencia_interna: null,
      rendimento: null,
      outro: null,
    };
    for (const movimento of TODOS_OS_MOVIMENTOS) {
      expect(ruleScopeForMovement(movimento), movimento).toBe(esperado[movimento]);
    }
  });

  it("um movimento desconhecido não tem escopo", () => {
    expect(ruleScopeForMovement("nao_existe")).toBeNull();
  });

  it("os escopos de SCOPE_MOVEMENTS cobrem os movimentos sem repetir nenhum", () => {
    const vistos = RULE_SCOPES.flatMap((escopo) => SCOPE_MOVEMENTS[escopo]);
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(SCOPE_MOVEMENTS.conta_destino).toEqual([]);
  });
});

describe("chaveVazia", () => {
  it("nulo, vazio, só espaço e só '|' são chave vazia; um nome com documento não é", () => {
    expect(chaveVazia(null)).toBe(true);
    expect(chaveVazia("")).toBe(true);
    expect(chaveVazia("   ")).toBe(true);
    expect(chaveVazia("|")).toBe(true);
    expect(chaveVazia("|***.456.789-**")).toBe(false);
    expect(chaveVazia("[TEST] MARIA|***.456.789-**")).toBe(false);
  });
});

describe("mergeRuleSets", () => {
  it("sem ativa anterior, a regra nova vale como está (nulos continuam nulos)", () => {
    const nova = { ...VAZIA, setCategoryId: "cat-servicos" };
    expect(mergeRuleSets(null, nova)).toEqual(nova);
  });

  it("herda os set_* não nulos da ativa anterior quando a nova não os traz", () => {
    const antiga = { ...VAZIA, setCategoryId: "cat-servicos", setCustomName: "[TEST] Padaria" };
    const nova = { ...VAZIA, setSpendType: "extras" };
    expect(mergeRuleSets(antiga, nova)).toEqual({
      ...VAZIA,
      setCategoryId: "cat-servicos",
      setCustomName: "[TEST] Padaria",
      setSpendType: "extras",
    });
  });

  it("os campos da nova sobrepõem os da antiga quando são não nulos", () => {
    const antiga = { ...VAZIA, setCategoryId: "cat-servicos", setSpendType: "prazeres" };
    const nova = { ...VAZIA, setCategoryId: "cat-lazer" };
    expect(mergeRuleSets(antiga, nova)).toEqual({
      ...VAZIA,
      setCategoryId: "cat-lazer",
      setSpendType: "prazeres",
    });
  });

  it("regra de categoria, depois só de nome: uma regra com as duas coisas", () => {
    const antiga = { ...VAZIA, setCategoryId: "cat-servicos" };
    const nova = { ...VAZIA, setCustomName: "[TEST] Nome novo" };
    const mesclada = mergeRuleSets(antiga, nova);
    expect(mesclada.setCategoryId).toBe("cat-servicos");
    expect(mesclada.setCustomName).toBe("[TEST] Nome novo");
  });

  it("não muda a entrada: quem chama reaproveita os objetos", () => {
    const antiga = { ...VAZIA, setCategoryId: "cat-servicos" };
    const nova = { ...VAZIA, setSpendType: "extras" };
    mergeRuleSets(antiga, nova);
    expect(antiga).toEqual({ ...VAZIA, setCategoryId: "cat-servicos" });
    expect(nova).toEqual({ ...VAZIA, setSpendType: "extras" });
  });
});
