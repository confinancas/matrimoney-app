import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { reconcileHousehold } from "../../../src/worker/bank/classify";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { AGORA, criarLar, HOJE, inserirTransacao, lerTransacao } from "../helpers/regras";

// Correção da TASK-0207 (TASK-0302): a conciliação só desfaz a marca que a própria classificação pôs
// (categorized_by = 'regra' e rule_id nulo). A marca do casal (regra) e a da IA nunca são desfeitas.

describe("conciliação não desfaz marca do casal nem da IA", () => {
  it("regra do casal, marca da IA e marca própria: só a própria sai, e a volta atrás do R2 não alcança a IA", async () => {
    const lar = await criarLar();
    const doCasal = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 50000,
      descricao: "[TEST] Entrada do casal",
      localDate: "2026-11-07",
      incomeKind: "transferencia",
      categorizedBy: "regra",
      ruleId: "regra-do-casal",
    });
    const daIa = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 12345,
      descricao: "[TEST] Entrada da IA",
      localDate: "2026-11-06",
      incomeKind: "transferencia",
      categorizedBy: "ia",
    });
    const propria = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 777,
      descricao: "[TEST] Entrada própria",
      localDate: "2026-11-05",
      incomeKind: "transferencia",
      categorizedBy: "regra",
    });
    const cartaoDaIa = await inserirTransacao(lar, {
      na: "cartao",
      movement: "pix_recebido",
      amountCents: 30000,
      descricao: "[TEST] Pagamento de fatura marcado pela IA",
      localDate: "2026-11-02",
      categorizedBy: "ia",
    });
    const saidaDaIa = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -30000,
      descricao: "[TEST] Saída que casa com a fatura da IA",
      localDate: "2026-11-02",
    });
    const cartaoProprio = await inserirTransacao(lar, {
      na: "cartao",
      movement: "pix_recebido",
      amountCents: 20000,
      descricao: "[TEST] Pagamento por terceiro, classificação própria",
      localDate: "2026-11-02",
    });
    const saidaProppria = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -20000,
      descricao: "[TEST] Saída que casa com a fatura própria",
      localDate: "2026-11-03",
    });
    // Linhas de cartão de pagamento precisam do tipo de operação do Pluggy para serem reconhecidas como fatura.
    await env.DB.prepare(
      "UPDATE transactions SET provider_operation_type = 'PAGAMENTO_FATURA' WHERE id IN (?, ?)",
    )
      .bind(cartaoDaIa, cartaoProprio)
      .run();

    const db = createDb(env.DB, newMeter());
    await reconcileHousehold(db, lar.householdId, HOJE, AGORA);

    const casal = await lerTransacao(doCasal);
    expect(casal.income_kind).toBe("transferencia");
    expect(casal.categorized_by).toBe("regra");
    expect(casal.rule_id).toBe("regra-do-casal");

    const ia = await lerTransacao(daIa);
    expect(ia.income_kind).toBe("transferencia");
    expect(ia.categorized_by).toBe("ia");

    const minha = await lerTransacao(propria);
    expect(minha.income_kind).toBeNull();
    expect(minha.categorized_by).toBeNull();

    const cartaoIa = await lerTransacao(cartaoDaIa);
    expect(cartaoIa.movement).toBe("pix_recebido");
    expect(cartaoIa.categorized_by).toBe("ia");
    expect((await lerTransacao(saidaDaIa)).movement).toBe("pagamento_fatura");

    const cartaoProprioDepois = await lerTransacao(cartaoProprio);
    expect(cartaoProprioDepois.movement).toBe("pagamento_fatura");
    expect(cartaoProprioDepois.income_kind).toBe("transferencia");
    expect(cartaoProprioDepois.categorized_by).toBe("regra");
    expect((await lerTransacao(saidaProppria)).movement).toBe("pagamento_fatura");
  });

  it("uma segunda conciliação não muda nada", async () => {
    const lar = await criarLar();
    await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 4200,
      descricao: "[TEST] Entrada estável",
      localDate: "2026-11-07",
      incomeKind: "transferencia",
      categorizedBy: "ia",
    });
    const db = createDb(env.DB, newMeter());
    await reconcileHousehold(db, lar.householdId, HOJE, AGORA);
    const mudou = await reconcileHousehold(db, lar.householdId, HOJE, AGORA);
    expect(mudou).toBe(0);
  });
});
