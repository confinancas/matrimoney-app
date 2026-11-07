import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import type { MappedTransaction } from "../../src/worker/bank/map";
import { ingestTransactions } from "../../src/worker/bank/repository";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import { espiaDeParametros } from "./helpers/parametros";
import {
  AGORA,
  categoriaDoLar,
  contar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirComprasEmLote,
  inserirTransacao,
  type Lar,
  lerTransacao,
} from "./helpers/regras";

// Importação real (ingestTransactions) com regras: o pipeline roda no afterIngest, só com os inseridos.
const linhaDaImportacao = (
  lar: Lar,
  extra: Partial<MappedTransaction> & { descricao: string; contraparte?: string | null; doc?: string | null },
): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: lar.cardId,
  bill_id: null,
  futura: null,
  movement: "compra",
  occurred_at: "2026-11-09T14:00:00.000Z",
  local_date: "2026-11-09",
  amount_cents: -4590,
  original_description: extra.descricao,
  establishment_key: establishmentKey(extra.descricao),
  counterparty_name: extra.contraparte ?? null,
  counterparty_doc_masked: extra.doc ?? null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
  ...extra,
});

async function importar(lar: Lar, linhas: MappedTransaction[], meter?: Meter): Promise<string[]> {
  const db = createDb(env.DB, meter ?? newMeter());
  const { insertedIds } = await ingestTransactions(db, {
    householdId: lar.householdId,
    bankItemId: lar.bankItemId,
    rows: linhas,
    now: AGORA,
  });
  return insertedIds;
}

describe("pipeline na importação: regras que valem para as compras novas", () => {
  it("cenário 2 e chave: ' pag*josedasilva ' entra em Serviços pela regra, com rule_id, e não fica pendente", async () => {
    const lar = await criarLar();
    const regra = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*JOSEDASILVA",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });

    const [id] = await importar(lar, [linhaDaImportacao(lar, { descricao: " pag*josedasilva " })]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linha.categorized_by).toBe("regra");
    expect(linha.rule_id).toBe(regra);
    expect(linha.categorized_at).not.toBeNull();
  });

  it("cenário 13: regra criada em 'LOJA X 01/10' casa com 'LOJA X 02/10' (a marca de parcela sai da chave)", async () => {
    const lar = await criarLar();
    const regra = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: establishmentKey("LOJA X 01/10") ?? "",
      setCategoryId: categoriaDoLar(lar, "mercado"),
    });

    const [id] = await importar(lar, [linhaDaImportacao(lar, { descricao: "LOJA X 02/10" })]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.category_id).toBe(categoriaDoLar(lar, "mercado"));
    expect(linha.rule_id).toBe(regra);
  });

  it("'ASAAS12MAT' e 'ASAAS13MAT' são estabelecimentos diferentes: a regra de um não pega o outro", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "ASAAS12MAT",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });

    const [id] = await importar(lar, [linhaDaImportacao(lar, { descricao: "ASAAS13MAT" })]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.category_id).toBeNull();
    expect(linha.rule_id).toBeNull();
  });

  it("cenário 2 com regra de destinatário: Pix enviado para o mesmo nome e documento entra com a categoria", async () => {
    const lar = await criarLar();
    const regra = await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] MARIA|***.456.789-**",
      setCategoryId: categoriaDoLar(lar, "lazer"),
      createdFrom: "lembrar",
    });

    const [id] = await importar(lar, [
      linhaDaImportacao(lar, {
        descricao: "[TEST] Pix enviado",
        movement: "pix_enviado",
        account_id: lar.accountId,
        card_id: null,
        amount_cents: -2000,
        contraparte: " [test] maria ",
        doc: "***.456.789-**",
        provider_operation_type: "PIX",
      }),
    ]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.category_id).toBe(categoriaDoLar(lar, "lazer"));
    expect(linha.rule_id).toBe(regra);
  });
});

describe("pipeline: o que não entra na categoria", () => {
  it("cenário 8: a regra põe Serviços e a sugestão da IA (Presentes) continua como estava", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*JOSEDASILVA",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*JOSEDASILVA",
      aiCategoryId: categoriaDoLar(lar, "presentes"),
    });

    const resultado = await processNewTransactions(
      createDb(env.DB, newMeter()),
      lar.householdId,
      [id],
      AGORA,
    );

    const linha = await lerTransacao(id);
    expect(linha.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linha.ai_category_id).toBe(categoriaDoLar(lar, "presentes"));
    expect(resultado.categorizedByRule).toEqual([id]);
    expect(resultado.pending).toEqual([]);
  });

  it("cenário 9: regra com categoria arquivada não grava; a compra fica sem categoria e em pending", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*JOSEDASILVA",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });
    await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?")
      .bind(AGORA, categoriaDoLar(lar, "servicos"))
      .run();
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*JOSEDASILVA",
    });

    const resultado = await processNewTransactions(
      createDb(env.DB, newMeter()),
      lar.householdId,
      [id],
      AGORA,
    );

    expect((await lerTransacao(id)).category_id).toBeNull();
    expect(resultado.categorizedByRule).toEqual([]);
    expect(resultado.pending).toEqual([id]);
  });

  it("cenário 15: regra só de nome põe o nome, sem categoria e sem categorized_at, e a compra segue em pending", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PADARIA DA ESQUINA",
      setCustomName: "Pão de cada dia",
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -800,
      descricao: "PADARIA DA ESQUINA",
    });

    const resultado = await processNewTransactions(
      createDb(env.DB, newMeter()),
      lar.householdId,
      [id],
      AGORA,
    );

    const linha = await lerTransacao(id);
    expect(linha.custom_name).toBe("Pão de cada dia");
    expect(linha.category_id).toBeNull();
    expect(linha.categorized_by).toBeNull();
    expect(resultado.pending).toEqual([id]);
  });

  it("nome próprio da transação não é trocado pela regra", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PADARIA DA ESQUINA",
      setCustomName: "Pão",
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -800,
      descricao: "PADARIA DA ESQUINA",
      customName: "[TEST] Nome do casal",
    });

    await processNewTransactions(createDb(env.DB, newMeter()), lar.householdId, [id], AGORA);

    expect((await lerTransacao(id)).custom_name).toBe("[TEST] Nome do casal");
  });

  it("metas e investimentos nunca vão para uma compra de cartão: a categoria entra, o tipo não", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "CARTORIO X",
      setCategoryId: categoriaDoLar(lar, "servicos"),
      setSpendType: "metas",
    });

    const [id] = await importar(lar, [linhaDaImportacao(lar, { descricao: "CARTORIO X" })]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linha.spend_type).toBeNull();
    expect(linha.spend_type_source).toBeNull();
  });

  it("o tipo comum da regra vai para a compra, com a procedência 'regra'", async () => {
    const lar = await criarLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "FARMACIA Y", setSpendType: "extras" });

    const [id] = await importar(lar, [linhaDaImportacao(lar, { descricao: "FARMACIA Y" })]);

    const linha = await lerTransacao(id ?? "");
    expect(linha.spend_type).toBe("extras");
    expect(linha.spend_type_source).toBe("regra");
    expect(linha.category_id).toBeNull();
  });

  it("cenário 12: a regra e a transação de um lar não são lidas nem alteradas pelo pipeline de outro lar", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*JOSEDASILVA",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*JOSEDASILVA",
    });
    const outro = await criarOutroLar();

    const resultado = await processNewTransactions(
      createDb(env.DB, newMeter()),
      outro.householdId,
      [id],
      AGORA,
    );

    const linha = await lerTransacao(id);
    expect(linha.category_id).toBeNull();
    expect(linha.household_id).toBe(lar.householdId);
    expect(resultado).toEqual({ categorizedByRule: [], pending: [] });
  });

  it("uma compra que já tem categoria não é tocada pela regra", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*JOSEDASILVA",
      setCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*JOSEDASILVA",
      categoryId: categoriaDoLar(lar, "lazer"),
      categorizedBy: lar.memberId,
    });

    await processNewTransactions(createDb(env.DB, newMeter()), lar.householdId, [id], AGORA);

    expect((await lerTransacao(id)).category_id).toBe(categoriaDoLar(lar, "lazer"));
  });
});

describe("custo do pipeline e da gravação", () => {
  it("pipeline com 100 transações: no máximo 2 chamadas ao D1, e nenhum comando com mais de 100 parâmetros", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "MERCADO LOTE",
      setCategoryId: categoriaDoLar(lar, "mercado"),
    });
    await inserirComprasEmLote(lar, 100, "MERCADO LOTE");
    const ids = (
      await env.DB.prepare("SELECT id FROM transactions WHERE household_id = ? ORDER BY id")
        .bind(lar.householdId)
        .all<{ id: string }>()
    ).results.map((linha) => linha.id);
    expect(ids).toHaveLength(100);

    const medidor = newMeter();
    const espiado = espiaDeParametros(env.DB);
    const resultado = await processNewTransactions(
      createDb(espiado.env, medidor),
      lar.householdId,
      ids,
      AGORA,
    );

    expect(resultado.categorizedByRule).toHaveLength(100);
    expect(medidor.calls).toBeLessThanOrEqual(2);
    expect(espiado.maiorComando()).toBeLessThanOrEqual(100);
    console.info(
      `[medicao] pipeline 100 transações: calls=${medidor.calls} statements=${medidor.statements} rowsRead=${medidor.rowsRead} rowsWritten=${medidor.rowsWritten} maiorComando=${espiado.maiorComando()}`,
    );
  });

  it("gravação de 200 linhas com a regra ativa, inteira (gravação, classificação, ciclo e regras)", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PADARIA LOTE 200",
      setCategoryId: categoriaDoLar(lar, "mercado"),
    });
    const linhas = Array.from({ length: 200 }, (_, i) =>
      linhaDaImportacao(lar, {
        descricao: i % 2 === 0 ? "PADARIA LOTE 200" : `[TEST] Loja ${i}`,
        amount_cents: -1000 - i,
        local_date: "2026-11-09",
        occurred_at: "2026-11-09T14:00:00.000Z",
      }),
    );
    const medidor = newMeter();
    const espiado = espiaDeParametros(env.DB);
    const { insertedIds } = await ingestTransactions(createDb(espiado.env, medidor), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      rows: linhas,
      now: AGORA,
    });

    expect(insertedIds).toHaveLength(200);
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE category_id IS NOT NULL")).toBe(
      100,
    );
    expect(medidor.calls).toBeLessThanOrEqual(50);
    expect(espiado.maiorComando()).toBeLessThanOrEqual(100);
    console.info(
      `[medicao] gravação 200 linhas com regra: calls=${medidor.calls} statements=${medidor.statements} rowsRead=${medidor.rowsRead} rowsWritten=${medidor.rowsWritten} maiorComando=${espiado.maiorComando()}`,
    );
  });
});
