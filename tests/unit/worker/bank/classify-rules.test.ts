import { describe, expect, it } from "vitest";
import { normalizeStatementText } from "../../../../src/shared/statement-text";
import {
  CARD_BILL_PAYMENT_RE,
  type ContextoClassificacao,
  classify,
  type Decisao,
  ESTORNO_RE,
  estaProtegida,
  isBankBillPayment,
  type LinhaClassificavel,
  pairBillPayments,
  pairTransfers,
  RENDIMENTO_RE,
  RESGATE_RE,
  somaDias,
} from "../../../../src/worker/bank/classify-rules";

const HOJE = "2026-11-10";
const CTX: ContextoClassificacao = {
  hoje: HOJE,
  cpfsDoLar: ["***.456.789-**"],
  bancosComCartao: ["Nubank"],
};
const AGORA = "2026-11-10T12:00:00.000Z";

// Linha de conta do lar (BANK) por padrão. Os campos são os de transactions.
function linha(extra: Partial<LinhaClassificavel> & { id: string }): LinhaClassificavel {
  return {
    account_id: "conta-a",
    card_id: null,
    movement: "pix_enviado",
    movement_original: null,
    movement_locked: 0,
    hidden: 0,
    removed_at: null,
    categorized_by: null,
    categorized_at: null,
    rule_id: null,
    income_kind: null,
    income_subtype: null,
    local_date: "2026-11-05",
    amount_cents: -1000,
    original_description: "[TEST] Movimento",
    provider_category: null,
    provider_operation_type: null,
    counterparty_doc_masked: null,
    ...extra,
  };
}

// Compra ou pagamento do cartão: amount_cents positivo é pagamento (a convenção do mapeamento).
function cartao(extra: Partial<LinhaClassificavel> & { id: string }): LinhaClassificavel {
  return linha({
    account_id: null,
    card_id: "cartao-nubank",
    movement: "pagamento_fatura",
    amount_cents: 287040,
    original_description: "[TEST] PAGAMENTO RECEBIDO",
    provider_operation_type: "PAGAMENTO_FATURA",
    ...extra,
  });
}

// Mapa id → decisão, para ler a decisão de cada linha pelo id.
function decidir(linhas: LinhaClassificavel[], ctx: ContextoClassificacao = CTX): Map<string, Decisao> {
  return new Map(classify(linhas, ctx).map((decisao) => [decisao.id, decisao]));
}

// Aplica as decisões como a gravação faz (mesma regra da classify.ts), para testar a segunda passada.
function aplicar(linhas: LinhaClassificavel[], decisoes: Map<string, Decisao>): LinhaClassificavel[] {
  return linhas.map((original) => {
    const decisao = decisoes.get(original.id);
    if (!decisao || estaProtegida(original) || original.removed_at !== null) return original;
    const mudaMovimento = decisao.movement !== original.movement;
    const mudaRenda =
      decisao.income_kind !== original.income_kind || decisao.income_subtype !== original.income_subtype;
    if (!mudaMovimento && !mudaRenda) return original;
    let categorizadoPor = original.categorized_by;
    let categorizadoEm = original.categorized_at;
    if (decisao.income_kind !== original.income_kind) {
      categorizadoPor = decisao.income_kind === null ? null : "regra";
      categorizadoEm = decisao.income_kind === null ? null : AGORA;
    }
    return {
      ...original,
      movement: decisao.movement,
      movement_original: mudaMovimento
        ? (original.movement_original ?? original.movement)
        : original.movement_original,
      income_kind: decisao.income_kind,
      income_subtype: decisao.income_subtype,
      categorized_by: categorizadoPor,
      categorized_at: categorizadoEm,
    };
  });
}

describe("expressões", () => {
  const texto = (s: string) => normalizeStatementText(s);

  it("CARD_BILL_PAYMENT_RE casa pagamento de fatura de cartão, com e sem acento e em maiúsculas", () => {
    expect(CARD_BILL_PAYMENT_RE.test(texto("PAG FATURA CARTAO"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("pagamento da fatura do cartão"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("Fatura Cartões"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("FAT CREDITO"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("PAGTO CARTAO"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("PAGAMENTO CARTÃO"))).toBe(true);
  });

  it("CARD_BILL_PAYMENT_RE não casa fatura de outra coisa, nem pagamento sem a palavra do cartão", () => {
    expect(CARD_BILL_PAYMENT_RE.test(texto("PAGAMENTO FATURA VIVO"))).toBe(false);
    expect(CARD_BILL_PAYMENT_RE.test(texto("PAGAMENTOS NU"))).toBe(false);
    expect(CARD_BILL_PAYMENT_RE.test(texto("COMPRA NO CARTAO"))).toBe(false);
  });

  it("CARD_BILL_PAYMENT_RE aceita até 12 caracteres entre fatura e cartão, e não 13", () => {
    expect(CARD_BILL_PAYMENT_RE.test(texto("FATURA ABCDEFGHIJ CARTAO"))).toBe(true);
    expect(CARD_BILL_PAYMENT_RE.test(texto("FATURA ABCDEFGHIJK CARTAO"))).toBe(false);
  });

  it("ESTORNO_RE casa estorno e devolução inteiras, não palavras que só começam igual", () => {
    expect(ESTORNO_RE.test(texto("PIX DEVOLVIDO"))).toBe(true);
    expect(ESTORNO_RE.test(texto("estorno compra"))).toBe(true);
    expect(ESTORNO_RE.test(texto("Estornado"))).toBe(true);
    expect(ESTORNO_RE.test(texto("DEVOLUCAO DE VALOR"))).toBe(true);
    expect(ESTORNO_RE.test(texto("DEVOLVIDOS"))).toBe(false);
    expect(ESTORNO_RE.test(texto("ESTORNOS"))).toBe(false);
  });

  it("RENDIMENTO_RE casa rendimento, remuneração e juros sobre saldo, com ou sem barra", () => {
    expect(RENDIMENTO_RE.test(texto("RENDIMENTO CAIXINHA"))).toBe(true);
    expect(RENDIMENTO_RE.test(texto("rendimentos"))).toBe(true);
    expect(RENDIMENTO_RE.test(texto("Remuneração conta"))).toBe(true);
    expect(RENDIMENTO_RE.test(texto("JUROS S/ SALDO"))).toBe(true);
    expect(RENDIMENTO_RE.test(texto("JUROS S/SALDO"))).toBe(true);
    expect(RENDIMENTO_RE.test(texto("RENDIMENTA"))).toBe(false);
  });

  it("RESGATE_RE casa resgate e resg, por palavra", () => {
    expect(RESGATE_RE.test(texto("RESGATE RDB"))).toBe(true);
    expect(RESGATE_RE.test(texto("resg cdb"))).toBe(true);
    expect(RESGATE_RE.test(texto("RESGATEADO"))).toBe(false);
  });

  it("somaDias muda o dia de calendário sem fuso", () => {
    expect(somaDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somaDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("R1: pagamento na conta", () => {
  it("saída BANK com CARTAO no texto vira pagamento_fatura", () => {
    const decisoes = decidir([
      linha({ id: "s1", original_description: "[TEST] PAG FATURA CARTAO", amount_cents: -287040 }),
    ]);
    expect(decisoes.get("s1")).toMatchObject({ movement: "pagamento_fatura", regra: "R1" });
  });

  it("'PAGAMENTO FATURA NUBANK' com cartão Nubank no lar é R1; 'PAGAMENTO FATURA VIVO' não é", () => {
    const nubank = linha({
      id: "n",
      original_description: "[TEST] PAGAMENTO FATURA NUBANK",
      amount_cents: -10000,
    });
    const vivo = linha({
      id: "v",
      original_description: "[TEST] PAGAMENTO FATURA VIVO",
      amount_cents: -12990,
    });
    const decisoes = decidir([nubank, vivo]);
    expect(decisoes.get("n")).toMatchObject({ movement: "pagamento_fatura", regra: "R1" });
    expect(decisoes.get("v")).toMatchObject({ movement: "pix_enviado", regra: "sem-regra" });
  });

  it("categoria 'Credit card payment' na saída basta", () => {
    const l = linha({
      id: "c",
      provider_category: "Credit card payment",
      amount_cents: -5000,
      movement: "debito",
    });
    expect(isBankBillPayment(l, CTX)).toBe(true);
  });

  it("'FATURA' sem banco do lar nem CARTAO não é R1, e a saída de uma categoria fora da lista não é R1", () => {
    expect(
      isBankBillPayment(linha({ id: "a", original_description: "FATURA VIVO", amount_cents: -100 }), CTX),
    ).toBe(false);
    expect(
      isBankBillPayment(
        linha({ id: "b", original_description: "PAG FATURA CARTAO", amount_cents: -100, movement: "compra" }),
        CTX,
      ),
    ).toBe(false);
    expect(
      isBankBillPayment(
        linha({ id: "c", original_description: "PAG FATURA CARTAO", amount_cents: 100 }),
        CTX,
      ),
    ).toBe(false);
  });

  it("a entrada de conta nunca é R1", () => {
    const entrada = linha({
      id: "e",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: 100,
      movement: "pix_recebido",
    });
    expect(isBankBillPayment(entrada, CTX)).toBe(false);
  });
});

describe("R2: pagamento no cartão e pareamento", () => {
  it("pareia pagamento de cartão com a saída de mesmo valor até 5 dias (5 pareia, 6 não)", () => {
    const cartaoPag = cartao({ id: "c", local_date: "2026-11-06" });
    const emCinco = linha({
      id: "s5",
      local_date: "2026-11-11",
      amount_cents: -287040,
      movement: "pix_enviado",
    });
    const emSeis = linha({
      id: "s6",
      local_date: "2026-11-12",
      amount_cents: -287040,
      movement: "pix_enviado",
    });

    expect(pairBillPayments([cartaoPag], [emCinco])).toEqual([{ cartao: "c", banco: "s5" }]);
    expect(pairBillPayments([cartaoPag], [emSeis])).toEqual([]);
  });

  it("pareamento de pagamento: o de distância 0 vence o de 2 dias; no empate, o de menor id", () => {
    const c = cartao({ id: "c", local_date: "2026-11-06" });
    const bDoze = linha({ id: "b-2", local_date: "2026-11-08", amount_cents: -287040 });
    const bMesmo = linha({ id: "b-9", local_date: "2026-11-06", amount_cents: -287040 });
    expect(pairBillPayments([c], [bDoze, bMesmo])).toEqual([{ cartao: "c", banco: "b-9" }]);

    const cempre = cartao({ id: "c-9", local_date: "2026-11-06" });
    const cdois = cartao({ id: "c-1", local_date: "2026-11-06" });
    const banco = linha({ id: "b-5", local_date: "2026-11-06", amount_cents: -287040 });
    // Mesmo dia: o de menor id entre os cartões vence, e cada linha entra em um par só.
    expect(pairBillPayments([cempre, cdois], [banco])).toEqual([{ cartao: "c-1", banco: "b-5" }]);
  });

  it("R2 pareia com saída que o banco não rotulou como pagamento (Pix que paga a fatura)", () => {
    const pix = linha({
      id: "pix",
      original_description: "[TEST] PIX ENVIADO NU PAGAMENTOS",
      amount_cents: -287040,
      movement: "pix_enviado",
    });
    const decisoes = decidir([cartao({ id: "c", local_date: "2026-11-09" }), pix]);
    expect(decisoes.get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      regra: "R2-par",
    });
    expect(decisoes.get("pix")).toMatchObject({ movement: "pagamento_fatura", regra: "R2-par" });
  });

  it("sem par e mais recente que 5 dias: fica pagamento_fatura, sem renda", () => {
    const d = decidir([cartao({ id: "c", local_date: "2026-11-06" })], { ...CTX, hoje: "2026-11-09" });
    expect(d.get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
      regra: "R2-recente",
    });
  });

  it("sem par e 5 dias ou mais: pagamento por terceiro vira pix_recebido, sem renda (dia 4 e dia 5)", () => {
    const entrada = cartao({ id: "c", local_date: "2026-11-05" });
    const diaQuatro = decidir([entrada], { ...CTX, hoje: "2026-11-09" });
    const diaCinco = decidir([entrada], { ...CTX, hoje: "2026-11-10" });
    expect(diaQuatro.get("c")).toMatchObject({ movement: "pagamento_fatura", regra: "R2-recente" });
    expect(diaCinco.get("c")).toMatchObject({
      movement: "pix_recebido",
      income_kind: null,
      regra: "R2-terceiro",
    });
  });

  it("volta atrás: a linha de terceiro que ganha par volta a pagamento_fatura e transferência", () => {
    const entrada = cartao({ id: "c", local_date: "2026-11-05" });
    const primeira = decidir([entrada]);
    expect(primeira.get("c")).toMatchObject({ movement: "pix_recebido", regra: "R2-terceiro" });

    const gravada = aplicar([entrada], primeira);
    const saida = linha({
      id: "s",
      original_description: "[TEST] PIX ENVIADO NU",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-05",
    });
    const segunda = decidir([...gravada, saida]);
    expect(segunda.get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      regra: "R2-par",
    });
    expect(segunda.get("s")).toMatchObject({ movement: "pagamento_fatura", regra: "R2-par" });
  });

  it("a volta atrás tira categorized_by na gravação: a linha de terceiro não tem marca", () => {
    const entrada = cartao({ id: "c", local_date: "2026-11-05" });
    const gravada = aplicar([entrada], decidir([entrada]));
    expect(gravada[0]).toMatchObject({ movement: "pix_recebido", income_kind: null, categorized_by: null });
    expect(gravada[0]?.movement_original).toBe("pagamento_fatura");
  });
});

describe("R3: transferência entre as contas do lar", () => {
  const saida = (extra: Partial<LinhaClassificavel> & { id: string }) =>
    linha({ account_id: "conta-a", amount_cents: -50000, movement: "pix_enviado", ...extra });
  const entrada = (extra: Partial<LinhaClassificavel> & { id: string }) =>
    linha({ account_id: "conta-b", amount_cents: 50000, movement: "pix_recebido", ...extra });

  it("Pix entre o casal, com o CPF de uma conexão do lar como prova, vira transferência nos dois lados", () => {
    const s = saida({ id: "s", local_date: "2026-11-05", counterparty_doc_masked: "***.456.789-**" });
    const e = entrada({ id: "e", local_date: "2026-11-05" });
    const decisoes = decidir([s, e]);
    expect(decisoes.get("s")).toMatchObject({ movement: "transferencia_interna", regra: "R3" });
    expect(decisoes.get("e")).toMatchObject({
      movement: "transferencia_interna",
      income_kind: "transferencia",
      regra: "R3",
    });
  });

  it("'Same person transfer' de um lado também é prova", () => {
    const s = saida({ id: "s", local_date: "2026-11-05", provider_category: "Same person transfer" });
    const e = entrada({ id: "e", local_date: "2026-11-05" });
    expect(decidir([s, e]).get("e")).toMatchObject({ movement: "transferencia_interna", regra: "R3" });
  });

  it("sem prova, nada pareia", () => {
    const s = saida({ id: "s", local_date: "2026-11-05", counterparty_doc_masked: "***.111.222-**" });
    const e = entrada({ id: "e", local_date: "2026-11-05", counterparty_doc_masked: "***.333.444-**" });
    const decisoes = decidir([s, e]);
    expect(decisoes.get("s")).toMatchObject({ movement: "pix_enviado", regra: "sem-regra" });
    expect(decisoes.get("e")).toMatchObject({
      movement: "pix_recebido",
      income_kind: null,
      regra: "sem-regra",
    });
  });

  it("até 2 dias pareia; 3 dias não (fronteira)", () => {
    const s = saida({ id: "s", local_date: "2026-11-05", provider_category: "Same person transfer" });
    const emDois = entrada({ id: "e2", local_date: "2026-11-07", provider_category: "Same person transfer" });
    const emTres = entrada({ id: "e3", local_date: "2026-11-08", provider_category: "Same person transfer" });
    expect(pairTransfers([s], [emDois], CTX)).toEqual([{ saida: "s", entrada: "e2" }]);
    expect(pairTransfers([s], [emTres], CTX)).toEqual([]);
  });

  it("duas transferências iguais no mesmo dia: dois pares, cada linha em um só", () => {
    const s1 = saida({
      id: "s1",
      local_date: "2026-11-05",
      amount_cents: -20000,
      provider_category: "Same person transfer",
    });
    const s2 = saida({
      id: "s2",
      local_date: "2026-11-05",
      amount_cents: -20000,
      provider_category: "Same person transfer",
    });
    const e1 = entrada({
      id: "e1",
      local_date: "2026-11-05",
      amount_cents: 20000,
      provider_category: "Same person transfer",
    });
    const e2 = entrada({
      id: "e2",
      local_date: "2026-11-05",
      amount_cents: 20000,
      provider_category: "Same person transfer",
    });
    const pares = pairTransfers([s1, s2], [e1, e2], CTX);
    expect(pares).toHaveLength(2);
    expect(new Set(pares.flatMap((par) => [par.saida, par.entrada])).size).toBe(4);
    const decisoes = decidir([s1, s2, e1, e2]);
    for (const id of ["s1", "s2", "e1", "e2"])
      expect(decisoes.get(id)?.movement).toBe("transferencia_interna");
  });

  it("entrada do próprio CPF sem par vira transferência (R3b)", () => {
    const e = entrada({ id: "e", local_date: "2026-11-05", counterparty_doc_masked: "***.456.789-**" });
    expect(decidir([e]).get("e")).toMatchObject({
      movement: "transferencia_interna",
      income_kind: "transferencia",
      regra: "R3b",
    });
  });
});

describe("R4, R5 e R6: estorno, rendimento e resgate", () => {
  it("'PIX DEVOLVIDO' de entrada vira estorno (R4)", () => {
    const e = linha({
      id: "e",
      account_id: "conta-a",
      amount_cents: 6000,
      movement: "pix_recebido",
      original_description: "[TEST] PIX DEVOLVIDO",
    });
    expect(decidir([e]).get("e")).toMatchObject({ movement: "estorno", regra: "R4" });
  });

  it("rendimento por texto ou por categoria vira rendimento como renda variável (R5)", () => {
    const porTexto = linha({
      id: "a",
      account_id: "conta-a",
      amount_cents: 1234,
      movement: "outro",
      original_description: "[TEST] RENDIMENTO CAIXINHA",
    });
    const porCategoria = linha({
      id: "b",
      account_id: "conta-a",
      amount_cents: 500,
      movement: "outro",
      provider_category: "Proceeds interests and dividends",
    });
    const decisoes = decidir([porTexto, porCategoria]);
    expect(decisoes.get("a")).toMatchObject({
      movement: "rendimento",
      income_kind: "variavel",
      income_subtype: "rendimento",
      regra: "R5",
    });
    expect(decisoes.get("b")).toMatchObject({
      movement: "rendimento",
      income_kind: "variavel",
      income_subtype: "rendimento",
      regra: "R5",
    });
  });

  it("resgate de caixinha vira transferência (R6), por texto ou por operação", () => {
    const porTexto = linha({
      id: "r1",
      account_id: "conta-a",
      amount_cents: 30000,
      movement: "outro",
      original_description: "[TEST] RESGATE RDB",
    });
    const porOperacao = linha({
      id: "r2",
      account_id: "conta-a",
      amount_cents: 30000,
      movement: "outro",
      provider_operation_type: "RESGATE_APLIC_FINANCEIRA",
    });
    const decisoes = decidir([porTexto, porOperacao]);
    expect(decisoes.get("r1")).toMatchObject({
      movement: "transferencia_interna",
      income_kind: "transferencia",
      regra: "R6",
    });
    expect(decisoes.get("r2")).toMatchObject({
      movement: "transferencia_interna",
      income_kind: "transferencia",
      regra: "R6",
    });
  });

  it("'RENDIMENTO RESGATE' é R5 (vem antes de R6)", () => {
    const e = linha({
      id: "x",
      account_id: "conta-a",
      amount_cents: 100,
      movement: "outro",
      original_description: "RENDIMENTO RESGATE",
    });
    expect(decidir([e]).get("x")?.regra).toBe("R5");
  });

  it("'PIX DEVOLVIDO' que é transferência com prova fica transferência, não estorno (R3 antes de R4)", () => {
    const s = linha({
      id: "s",
      account_id: "conta-a",
      amount_cents: -6000,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    const e = linha({
      id: "e",
      account_id: "conta-b",
      amount_cents: 6000,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      original_description: "[TEST] PIX DEVOLVIDO",
      provider_category: "Same person transfer",
    });
    expect(decidir([s, e]).get("e")).toMatchObject({ movement: "transferencia_interna", regra: "R3" });
  });
});

describe("linhas que a classificação nunca toca", () => {
  // Cada caso: uma linha que mudaria sem a proteção (o controle), e a mesma linha com a proteção, que não muda.
  const estorno = (extra: Partial<LinhaClassificavel>) =>
    linha({
      id: "e",
      account_id: "conta-a",
      amount_cents: 6000,
      movement: "pix_recebido",
      original_description: "[TEST] PIX DEVOLVIDO",
      ...extra,
    });

  it("oculta (hidden = 1) não muda; sem a marca, muda para estorno", () => {
    expect(decidir([estorno({})]).get("e")?.movement).toBe("estorno");
    expect(decidir([estorno({ hidden: 1 })]).get("e")).toMatchObject({
      movement: "pix_recebido",
      regra: "protegida",
    });
  });

  it("travada (movement_locked = 1) não muda; sem a trava, muda para estorno", () => {
    expect(decidir([estorno({})]).get("e")?.movement).toBe("estorno");
    expect(decidir([estorno({ movement_locked: 1 })]).get("e")).toMatchObject({
      movement: "pix_recebido",
      regra: "protegida",
    });
  });

  it("categorizada por membro não muda; categorizada pela regra ou pela IA muda", () => {
    const renda = linha({
      id: "r",
      account_id: "conta-a",
      amount_cents: 1234,
      movement: "outro",
      original_description: "[TEST] RENDIMENTO CAIXINHA",
    });
    expect(decidir([renda]).get("r")?.movement).toBe("rendimento");
    expect(decidir([{ ...renda, categorized_by: "regra" }]).get("r")?.movement).toBe("rendimento");
    expect(decidir([{ ...renda, categorized_by: "ia" }]).get("r")?.movement).toBe("rendimento");
    expect(decidir([{ ...renda, categorized_by: "membro-1" }]).get("r")).toMatchObject({
      movement: "outro",
      regra: "protegida",
    });
    expect(estaProtegida({ ...renda, categorized_by: "membro-1" })).toBe(true);
  });

  it("removida (removed_at) não muda e não conta como par", () => {
    const removida = estorno({ removed_at: "2026-11-01T00:00:00.000Z" });
    expect(decidir([removida]).get("e")).toMatchObject({ movement: "pix_recebido", regra: "protegida" });
    // Saída removida não pareia com o pagamento do cartão: o cartão vira pagamento por terceiro.
    const saidaRemovida = linha({
      id: "s",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      removed_at: "2026-11-06T00:00:00.000Z",
    });
    expect(decidir([cartao({ id: "c", local_date: "2026-11-05" }), saidaRemovida]).get("c")).toMatchObject({
      movement: "pix_recebido",
      regra: "R2-terceiro",
    });
  });

  it("o casal decidiu uma saída (categorizada por membro): ela não muda, mas conta como par (cenário 14)", () => {
    const pix = linha({
      id: "pix",
      original_description: "[TEST] PIX ENVIADO NU PAGAMENTOS",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-09",
      categorized_by: "membro-1",
      categorized_at: "2026-11-09T20:00:00.000Z",
      provider_category: "Services",
    });
    const decisoes = decidir([cartao({ id: "c", local_date: "2026-11-09" }), pix]);
    expect(decisoes.get("pix")).toMatchObject({ movement: "pix_enviado", regra: "protegida" });
    expect(decisoes.get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      regra: "R2-par",
    });
  });

  it("saída travada (cenário 15) não muda, mesmo com par de mesmo valor", () => {
    const travada = linha({
      id: "s",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -287040,
      movement: "outro",
      movement_locked: 1,
      local_date: "2026-11-09",
    });
    const decisoes = decidir([travada, cartao({ id: "c", local_date: "2026-11-09" })]);
    expect(decisoes.get("s")).toMatchObject({ movement: "outro", regra: "protegida" });
    expect(decisoes.get("c")).toMatchObject({ movement: "pagamento_fatura", income_kind: "transferencia" });
  });

  it("casal categoriza a entrada como variável (cenário 11): ela não muda quando chega o par", () => {
    const entrada = linha({
      id: "e",
      account_id: "conta-b",
      amount_cents: 50000,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      categorized_by: "membro-1",
      categorized_at: "2026-11-05T20:00:00.000Z",
      income_kind: "variavel",
      income_subtype: "venda",
      counterparty_doc_masked: "***.111.222-**",
    });
    const saida = linha({
      id: "s",
      account_id: "conta-a",
      amount_cents: -50000,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      counterparty_doc_masked: "***.456.789-**",
    });
    const decisoes = decidir([entrada, saida]);
    expect(decisoes.get("e")).toMatchObject({
      movement: "pix_recebido",
      income_kind: "variavel",
      regra: "protegida",
    });
    expect(decisoes.get("s")).toMatchObject({ movement: "transferencia_interna", regra: "R3" });
  });
});

describe("cenários em memória", () => {
  it("1. pagamento do casal: as duas são pagamento_fatura, a do cartão com transferência", () => {
    const s = linha({
      id: "s",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -287040,
      movement: "outro",
      local_date: "2026-11-05",
    });
    const c = cartao({ id: "c", local_date: "2026-11-06" });
    const decisoes = decidir([s, c]);
    expect(decisoes.get("s")).toMatchObject({ movement: "pagamento_fatura", income_kind: null, regra: "R1" });
    expect(decisoes.get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      regra: "R2-par",
    });
  });

  it("3. terceiro paga a fatura: sem saída igual, a entrada vira pix_recebido ao completar 5 dias", () => {
    const c = cartao({ id: "c", amount_cents: 150000, local_date: "2026-11-05" });
    expect(decidir([c], { ...CTX, hoje: "2026-11-09" }).get("c")?.movement).toBe("pagamento_fatura");
    expect(decidir([c], { ...CTX, hoje: "2026-11-10" }).get("c")).toMatchObject({
      movement: "pix_recebido",
      income_kind: null,
    });
  });

  it("9. estorno: 'PIX DEVOLVIDO' de +60,00 vira estorno", () => {
    const e = linha({
      id: "e",
      account_id: "conta-a",
      amount_cents: 6000,
      movement: "pix_recebido",
      original_description: "[TEST] PIX DEVOLVIDO",
    });
    expect(decidir([e]).get("e")).toMatchObject({ movement: "estorno", income_kind: null });
  });

  it("12. idempotência: a segunda passada não muda nada, e a linha oculta fica como está", () => {
    const s = linha({
      id: "s",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -287040,
      movement: "outro",
      local_date: "2026-11-05",
    });
    const c = cartao({ id: "c", local_date: "2026-11-06" });
    const oculta = linha({
      id: "o",
      account_id: "conta-a",
      amount_cents: 6000,
      movement: "pix_recebido",
      original_description: "[TEST] PIX DEVOLVIDO",
      hidden: 1,
    });
    const primeira = decidir([s, c, oculta]);
    const gravada = aplicar([s, c, oculta], primeira);
    const segunda = decidir(gravada);
    for (const id of ["s", "c", "o"]) {
      expect(segunda.get(id)?.movement).toBe(primeira.get(id)?.movement);
      expect(segunda.get(id)?.income_kind).toBe(primeira.get(id)?.income_kind);
    }
    expect(gravada.find((l) => l.id === "o")).toMatchObject({ movement: "pix_recebido", income_kind: null });
  });

  it("13. Pix que paga a fatura: sai do gasto, movement_original guarda o pix_enviado", () => {
    const pix = linha({
      id: "pix",
      original_description: "[TEST] PIX ENVIADO NU PAGAMENTOS",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-05",
    });
    const c = cartao({ id: "c", local_date: "2026-11-06" });
    const gravada = aplicar([pix, c], decidir([pix, c]));
    expect(gravada.find((l) => l.id === "pix")).toMatchObject({
      movement: "pagamento_fatura",
      movement_original: "pix_enviado",
    });
    expect(gravada.find((l) => l.id === "c")?.movement).toBe("pagamento_fatura");
    expect(gravada.some((l) => l.movement === "pix_recebido")).toBe(false);
  });

  it("R1 e depois R2: a saída do pagamento de fatura marcada por R1 não vira pagamento por terceiro", () => {
    const s = linha({
      id: "s",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-05",
    });
    const c = cartao({ id: "c", local_date: "2026-11-05" });
    const decisoes = decidir([s, c], { ...CTX, hoje: "2026-11-10" });
    expect(decisoes.get("c")?.movement).toBe("pagamento_fatura");
    expect(decisoes.get("s")?.movement).toBe("pagamento_fatura");
  });

  it("R1 se perde o texto: a linha volta a movement_original, sem marca", () => {
    const s = linha({
      id: "s",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-05",
    });
    const [gravada] = aplicar([s], decidir([s]));
    expect(gravada?.movement).toBe("pagamento_fatura");
    if (!gravada) throw new Error("linha gravada sumiu");
    const textoMudou: LinhaClassificavel = { ...gravada, original_description: "[TEST] PIX ENVIADO" };
    expect(decidir([textoMudou]).get("s")).toMatchObject({ movement: "pix_enviado", regra: "sem-regra" });
  });
});

describe("par desfeito", () => {
  it("a linha de cartão que perde o par volta sem a marca de transferência; a saída volta ao movimento de origem", () => {
    const c = cartao({ id: "c", local_date: "2026-11-09" });
    const s = linha({
      id: "s",
      original_description: "[TEST] PIX ENVIADO NU",
      amount_cents: -287040,
      movement: "pix_enviado",
      local_date: "2026-11-09",
    });
    const pareado = decidir([c, s]);
    expect(pareado.get("c")).toMatchObject({ income_kind: "transferencia", regra: "R2-par" });

    const gravada = aplicar([c, s], pareado);
    const cartaoSemPar = gravada.filter((l) => l.id === "c");
    expect(decidir(cartaoSemPar).get("c")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
      regra: "R2-recente",
    });
    const saidaSemPar = gravada.filter((l) => l.id === "s");
    expect(decidir(saidaSemPar).get("s")).toMatchObject({ movement: "pix_enviado", regra: "sem-regra" });
  });
});

describe("pareamentos", () => {
  it("pareamento é um a um: uma saída não serve a duas entradas", () => {
    const s = linha({
      id: "s",
      amount_cents: -20000,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    const e1 = linha({
      id: "e1",
      account_id: "conta-b",
      amount_cents: 20000,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    const e2 = linha({
      id: "e2",
      account_id: "conta-b",
      amount_cents: 20000,
      movement: "pix_recebido",
      local_date: "2026-11-06",
      provider_category: "Same person transfer",
    });
    const pares = pairTransfers([s], [e1, e2], CTX);
    expect(pares).toEqual([{ saida: "s", entrada: "e1" }]);
  });

  it("pareamento de transferência: a menor distância vence, no empate o menor id", () => {
    const s = linha({
      id: "s",
      amount_cents: -20000,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    const longe = linha({
      id: "e-1",
      account_id: "conta-b",
      amount_cents: 20000,
      movement: "pix_recebido",
      local_date: "2026-11-07",
      provider_category: "Same person transfer",
    });
    const perto = linha({
      id: "e-2",
      account_id: "conta-b",
      amount_cents: 20000,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    expect(pairTransfers([s], [longe, perto], CTX)).toEqual([{ saida: "s", entrada: "e-2" }]);
  });

  it("pareamento de transferência exige contas diferentes", () => {
    const s = linha({
      id: "s",
      account_id: "conta-a",
      amount_cents: -20000,
      movement: "pix_enviado",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    const mesma = linha({
      id: "e",
      account_id: "conta-a",
      amount_cents: 20000,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      provider_category: "Same person transfer",
    });
    expect(pairTransfers([s], [mesma], CTX)).toEqual([]);
  });

  it("a ordem das regras: R1 antes de R2, R4 antes de R5, R5 antes de R6", () => {
    const pagamento = linha({
      id: "a",
      original_description: "[TEST] PAG FATURA CARTAO",
      amount_cents: -100,
      movement: "outro",
      local_date: "2026-11-05",
    });
    // Texto de estorno e de rendimento ao mesmo tempo: R4 vem antes de R5, então é estorno.
    const estornoERendimento = linha({
      id: "b",
      account_id: "conta-b",
      amount_cents: 100,
      movement: "pix_recebido",
      local_date: "2026-11-05",
      original_description: "[TEST] DEVOLVIDO RENDIMENTO",
    });
    // Rendimento e resgate ao mesmo tempo: R5 vem antes de R6, então é rendimento.
    const rendimentoEResgate = linha({
      id: "c",
      account_id: "conta-b",
      amount_cents: 100,
      movement: "outro",
      local_date: "2026-11-05",
      original_description: "RENDIMENTO RESGATE",
    });
    const d = decidir([pagamento, estornoERendimento, rendimentoEResgate]);
    expect(d.get("a")?.regra).toBe("R1");
    expect(d.get("b")).toMatchObject({ movement: "estorno", regra: "R4" });
    expect(d.get("c")).toMatchObject({ movement: "rendimento", regra: "R5" });
  });

  it("classify não devolve linha para dentro de si: uma linha tem uma decisão por id", () => {
    const linhas = [linha({ id: "x" }), linha({ id: "y", amount_cents: 100, movement: "pix_recebido" })];
    const decisoes = classify(linhas, CTX);
    expect(decisoes.map((d) => d.id)).toEqual(["x", "y"]);
  });
});
