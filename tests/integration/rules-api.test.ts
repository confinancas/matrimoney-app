import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import { createApp } from "../../src/worker/app";
import type { MappedTransaction } from "../../src/worker/bank/map";
import { ingestTransactions } from "../../src/worker/bank/repository";
import { applyRuleRetroactiveSliceStmts } from "../../src/worker/categorization/apply";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
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

type App = Hono<AppEnv>;
type Resposta = { status: number; corpo: Record<string, unknown> };

// Chama a API com um ambiente próprio (o espião de parâmetros entra por aqui).
async function chamar(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  ambiente: { DB: D1Database } = env,
): Promise<Resposta> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), ambiente, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

// App de um lar, com a sessão dele. Os medidores de cada requisição vão para medidos (se houver).
const appDoLar = (sessao: { householdId: string; memberId: string }, medidos?: Meter[]): App =>
  createApp({
    resolveSession: async () => sessao,
    onMeter: medidos ? (meter) => medidos.push({ ...meter }) : undefined,
  });

const SERVICOS = (lar: Lar): string => categoriaDoLar(lar, "servicos");
const LAZER = (lar: Lar): string => categoriaDoLar(lar, "lazer");

const CHAVE_JOSE = "PAG*JOSEDASILVA";
const linhaCompra = (lar: Lar, descricao: string, valor = -4590): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: lar.cardId,
  bill_id: null,
  futura: null,
  movement: "compra",
  occurred_at: "2026-11-09T14:00:00.000Z",
  local_date: "2026-11-09",
  amount_cents: valor,
  original_description: descricao,
  establishment_key: establishmentKey(descricao),
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
});

async function importar(lar: Lar, linhas: MappedTransaction[]): Promise<string[]> {
  const { insertedIds } = await ingestTransactions(createDb(env.DB, newMeter()), {
    householdId: lar.householdId,
    bankItemId: lar.bankItemId,
    rows: linhas,
    now: AGORA,
  });
  return insertedIds;
}

// Três compras antigas de PAG*JOSEDASILVA (uma escolhida à mão em Lazer, uma sem categoria, uma com sugestão da IA)
// e a quarta, aberta, que o casal está categorizando.
async function cenarioDoJose(lar: Lar): Promise<{ antigas: string[]; aberta: string }> {
  const manual = await inserirTransacao(lar, {
    movement: "compra",
    amountCents: -3000,
    descricao: CHAVE_JOSE,
    categoryId: LAZER(lar),
    categorizedBy: lar.memberId,
  });
  const semCategoria = await inserirTransacao(lar, {
    movement: "compra",
    amountCents: -3100,
    descricao: CHAVE_JOSE,
  });
  const comSugestao = await inserirTransacao(lar, {
    movement: "compra",
    amountCents: -3200,
    descricao: CHAVE_JOSE,
    aiCategoryId: categoriaDoLar(lar, "presentes"),
  });
  const aberta = await inserirTransacao(lar, {
    movement: "compra",
    amountCents: -3300,
    descricao: CHAVE_JOSE,
  });
  return { antigas: [manual, semCategoria, comSugestao], aberta };
}

describe("sessão e lar: 401 sem sessão, 404 para o que é de outro lar", () => {
  it("sem sessão, todas as rotas de regras respondem 401", async () => {
    const lar = await criarLar();
    const { aberta } = await cenarioDoJose(lar);
    const semSessao = createApp();

    expect((await chamar(semSessao, "GET", `/api/transactions/${aberta}/categorization`)).status).toBe(401);
    expect(
      (
        await chamar(semSessao, "PUT", `/api/transactions/${aberta}/category`, {
          categoryId: "x",
          applyToAll: false,
        })
      ).status,
    ).toBe(401);
    expect((await chamar(semSessao, "POST", "/api/rules", {})).status).toBe(401);
    expect((await chamar(semSessao, "POST", "/api/rules/x/apply-retroactive")).status).toBe(401);
    expect((await chamar(semSessao, "DELETE", "/api/rules/x")).status).toBe(401);
  });

  it("lar B não lê nem altera a transação, a regra nem o retroativo do lar A", async () => {
    const lar = await criarLar();
    const { aberta } = await cenarioDoJose(lar);
    const appA = appDoLar(lar);
    const aplicada = await chamar(appA, "PUT", `/api/transactions/${aberta}/category`, {
      categoryId: SERVICOS(lar),
      applyToAll: true,
    });
    const regraA = (aplicada.corpo.rule as { id: string }).id;

    const outro = await criarOutroLar();
    const appB = appDoLar(outro);
    expect((await chamar(appB, "GET", `/api/transactions/${aberta}/categorization`)).status).toBe(404);
    expect(
      (
        await chamar(appB, "PUT", `/api/transactions/${aberta}/category`, {
          categoryId: LAZER(lar),
          applyToAll: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await chamar(appB, "POST", "/api/rules", {
          transactionId: aberta,
          set: { categoryId: LAZER(lar) },
          createdFrom: "lembrar",
        })
      ).status,
    ).toBe(404);
    expect((await chamar(appB, "POST", `/api/rules/${regraA}/apply-retroactive`)).status).toBe(404);
    expect((await chamar(appB, "DELETE", `/api/rules/${regraA}`)).status).toBe(404);

    expect((await lerTransacao(aberta)).category_id).toBe(SERVICOS(lar));
    expect(
      await contar("SELECT COUNT(*) AS total FROM rules WHERE id = ? AND disabled_at IS NULL", regraA),
    ).toBe(1);
  });
});

describe("Aplicar a todas: cenários 1, 3, 6 e 7", () => {
  it("cenário 1: 4 compras do mesmo estabelecimento em Serviços; as 3 antigas com categorized_by 'regra'; regra ativa aplicar_todas", async () => {
    const lar = await criarLar();
    const { antigas, aberta } = await cenarioDoJose(lar);
    const app = appDoLar(lar);

    const resposta = await chamar(app, "PUT", `/api/transactions/${aberta}/category`, {
      categoryId: SERVICOS(lar),
      applyToAll: true,
    });

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.retroactive).toEqual({ applied: 3, remaining: 0 });
    for (const id of [...antigas, aberta]) {
      expect((await lerTransacao(id)).category_id).toBe(SERVICOS(lar));
    }
    for (const id of antigas) {
      expect((await lerTransacao(id)).categorized_by).toBe("regra");
    }
    expect((await lerTransacao(aberta)).categorized_by).toBe(lar.memberId);
    expect((await lerTransacao(antigas[2] ?? "")).ai_category_id).toBe(categoriaDoLar(lar, "presentes"));
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE household_id = ? AND created_from = 'aplicar_todas' AND disabled_at IS NULL AND set_category_id = ?",
        lar.householdId,
        SERVICOS(lar),
      ),
    ).toBe(1);
  });

  it("cenário 3: switch desligado muda só a transação aberta, não cria regra, e a próxima compra vai para a fila", async () => {
    const lar = await criarLar();
    const { antigas, aberta } = await cenarioDoJose(lar);
    const app = appDoLar(lar);

    const resposta = await chamar(app, "PUT", `/api/transactions/${aberta}/category`, {
      categoryId: SERVICOS(lar),
      applyToAll: false,
    });

    expect(resposta.corpo.rule).toBeNull();
    expect(resposta.corpo.retroactive).toBeNull();
    expect((await lerTransacao(aberta)).category_id).toBe(SERVICOS(lar));
    expect((await lerTransacao(antigas[1] ?? "")).category_id).toBeNull();
    expect(await contar("SELECT COUNT(*) AS total FROM rules")).toBe(0);

    const [proxima] = await importar(lar, [linhaCompra(lar, CHAVE_JOSE)]);
    expect((await lerTransacao(proxima ?? "")).category_id).toBeNull();
  });

  it("cenário 6: 2.300 compras, primeira fatia 2.000 e restam 300; a segunda chamada zera (2 chamadas por requisição, no máximo)", async () => {
    const lar = await criarLar();
    await inserirComprasEmLote(lar, 2300, "[TEST] LOJA GRANDE");
    const aberta = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -900,
      descricao: "[TEST] LOJA GRANDE",
    });
    const medidos: Meter[] = [];
    const app = appDoLar(lar, medidos);

    const primeira = await chamar(app, "PUT", `/api/transactions/${aberta}/category`, {
      categoryId: SERVICOS(lar),
      applyToAll: true,
    });
    const regraId = (primeira.corpo.rule as { id: string }).id;
    const segunda = await chamar(app, "POST", `/api/rules/${regraId}/apply-retroactive`);

    expect(primeira.corpo.retroactive).toEqual({ applied: 2000, remaining: 300 });
    expect(segunda.corpo).toEqual({ applied: 300, remaining: 0 });
    expect(
      await contar("SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?", SERVICOS(lar)),
    ).toBe(2301);
    for (const meter of medidos) expect(meter.calls).toBeLessThanOrEqual(2);
    console.info(
      `[medicao] PUT applyToAll (2.300 linhas): calls=${medidos[0]?.calls} statements=${medidos[0]?.statements} rowsRead=${medidos[0]?.rowsRead} rowsWritten=${medidos[0]?.rowsWritten}; fatia retroativa: calls=${medidos[1]?.calls} statements=${medidos[1]?.statements} rowsRead=${medidos[1]?.rowsRead} rowsWritten=${medidos[1]?.rowsWritten}`,
    );
  });

  it("cenário 7: A aplica Serviços e B aplica Lazer no mesmo estabelecimento: a regra de B é a ativa, as fatias de A dão 409, e no fim tudo está em Lazer", async () => {
    const lar = await criarLar();
    const memberB = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, '[TEST] Pessoa B', 'conjuge', ?)",
    )
      .bind(memberB, lar.householdId, AGORA)
      .run();
    await inserirComprasEmLote(lar, 2300, "[TEST] LOJA DISPUTA");
    const aDaA = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -500,
      descricao: "[TEST] LOJA DISPUTA",
    });
    const aDoB = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -600,
      descricao: "[TEST] LOJA DISPUTA",
    });
    const appA = appDoLar({ householdId: lar.householdId, memberId: lar.memberId });
    const appB = appDoLar({ householdId: lar.householdId, memberId: memberB });

    const regraA = (
      (
        await chamar(appA, "PUT", `/api/transactions/${aDaA}/category`, {
          categoryId: SERVICOS(lar),
          applyToAll: true,
        })
      ).corpo.rule as { id: string }
    ).id;
    const respostaB = await chamar(appB, "PUT", `/api/transactions/${aDoB}/category`, {
      categoryId: LAZER(lar),
      applyToAll: true,
    });
    const regraB = (respostaB.corpo.rule as { id: string }).id;

    const fatiaDeA = await chamar(appA, "POST", `/api/rules/${regraA}/apply-retroactive`);
    expect(fatiaDeA.status).toBe(409);
    expect(fatiaDeA.corpo).toEqual({ error: "regra_inativa" });

    const segundaDeB = await chamar(appB, "POST", `/api/rules/${regraB}/apply-retroactive`);
    expect(segundaDeB.status).toBe(200);
    expect((segundaDeB.corpo as { remaining: number }).remaining).toBe(0);
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE household_id = ? AND scope = 'estabelecimento' AND disabled_at IS NULL",
        lar.householdId,
      ),
    ).toBe(1);
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?", LAZER(lar))).toBe(
      2302,
    );
  });

  it("o EXISTS do lote: a fatia de uma regra desativada não grava nada; a de uma regra ativa grava (controle)", async () => {
    const lar = await criarLar();
    await inserirComprasEmLote(lar, 50, "[TEST] LOJA EXISTS");
    const desativada = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "[TEST] LOJA EXISTS",
      setCategoryId: SERVICOS(lar),
      disabledAt: AGORA,
    });
    const db = createDb(env.DB, newMeter());
    const regra = (id: string) => ({
      id,
      scope: "estabelecimento" as const,
      matchValue: "[TEST] LOJA EXISTS",
      setCustomName: null,
      setCategoryId: SERVICOS(lar),
      setSpendType: null,
      setMovement: null,
    });
    const entrada = (id: string) => ({
      householdId: lar.householdId,
      rule: regra(id),
      excludeTransactionId: null,
      now: AGORA,
    });

    const semEfeito = await db.$client.batch(applyRuleRetroactiveSliceStmts(db, entrada(desativada)));
    expect(semEfeito.slice(0, 4).reduce((total, r) => total + (r.meta?.changes ?? 0), 0)).toBe(0);
    expect(
      await contar("SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?", SERVICOS(lar)),
    ).toBe(0);

    const ativa = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "[TEST] LOJA EXISTS",
      setCategoryId: SERVICOS(lar),
    });
    const comEfeito = await db.$client.batch(applyRuleRetroactiveSliceStmts(db, entrada(ativa)));
    expect(comEfeito.slice(0, 4).reduce((total, r) => total + (r.meta?.changes ?? 0), 0)).toBe(50);
  });

  it("duas requisições juntas: uma regra ativa por alvo, sem duplicar (o índice único parcial recusa a segunda)", async () => {
    const lar = await criarLar();
    const primeira = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] CONCORRENTE",
    });
    const segunda = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -200,
      descricao: "[TEST] CONCORRENTE",
    });
    const app = appDoLar(lar);

    const [a, b] = await Promise.all([
      chamar(app, "PUT", `/api/transactions/${primeira}/category`, {
        categoryId: SERVICOS(lar),
        applyToAll: true,
      }),
      chamar(app, "PUT", `/api/transactions/${segunda}/category`, {
        categoryId: LAZER(lar),
        applyToAll: true,
      }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE household_id = ? AND match_value = ? AND disabled_at IS NULL",
        lar.householdId,
        "[TEST] CONCORRENTE",
      ),
    ).toBe(1);
  });

  it("o índice único parcial recusa uma segunda regra ativa no mesmo alvo, direto no banco", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "[TEST] ALVO",
      setCategoryId: SERVICOS(lar),
    });

    await expect(
      criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] ALVO", setCategoryId: LAZER(lar) }),
    ).rejects.toThrow();
  });
});

describe("Lembrar para os próximos Pix: cenários 4 e 14", () => {
  const pix = (lar: Lar, extra: Partial<Parameters<typeof inserirTransacao>[1]> = {}) =>
    inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -2000,
      descricao: "[TEST] Pix enviado",
      contraparte: "[TEST] Maria",
      doc: "***.456.789-**",
      ...extra,
    });

  it("cenário 4: Pix com categoria e tipo Investimentos; os Pix novos entram com os dois, e o escolhido por uma pessoa não muda", async () => {
    const lar = await criarLar();
    const origem = await pix(lar, {
      categoryId: categoriaDoLar(lar, "presentes"),
      categorizedBy: lar.memberId,
      spendType: "prazeres",
      spendTypeSource: "escolhido",
    });
    const app = appDoLar(lar);

    const resposta = await chamar(app, "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: LAZER(lar), spendType: "investimentos" },
      createdFrom: "lembrar",
    });
    expect(resposta.status).toBe(201);

    const [novo] = await importar(lar, [
      {
        ...linhaCompra(lar, "[TEST] Pix enviado", -3000),
        movement: "pix_enviado",
        account_id: lar.accountId,
        card_id: null,
        counterparty_name: "[TEST] Maria",
        counterparty_doc_masked: "***.456.789-**",
        provider_operation_type: "PIX",
      },
    ]);
    const linhaNova = await lerTransacao(novo ?? "");
    expect(linhaNova.category_id).toBe(LAZER(lar));
    expect(linhaNova.spend_type).toBe("investimentos");
    expect(linhaNova.spend_type_source).toBe("regra");

    const escolhida = await lerTransacao(origem);
    expect(escolhida.category_id).toBe(categoriaDoLar(lar, "presentes"));
    expect(escolhida.spend_type).toBe("prazeres");
  });

  it("cenário 14: os iguais que esperavam passam para Serviços (categorized_by 'regra', em alsoResolved); o de Lazer não muda", async () => {
    const lar = await criarLar();
    const p1 = await pix(lar);
    const p2 = await pix(lar);
    const p3 = await pix(lar, {
      aiCategoryId: categoriaDoLar(lar, "presentes"),
      categorizedBy: "ia",
      categoryId: categoriaDoLar(lar, "presentes"),
    });
    const p4 = await pix(lar, { categoryId: LAZER(lar), categorizedBy: lar.memberId });
    const origem = await pix(lar);
    const app = appDoLar(lar);

    const resposta = await chamar(app, "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: SERVICOS(lar) },
      createdFrom: "lembrar",
    });

    expect(resposta.status).toBe(201);
    expect([...(resposta.corpo.alsoResolved as string[])].sort()).toEqual([p1, p2, p3].sort());
    for (const id of [p1, p2, p3]) {
      const linha = await lerTransacao(id);
      expect(linha.category_id).toBe(SERVICOS(lar));
      expect(linha.categorized_by).toBe("regra");
    }
    expect((await lerTransacao(p3)).ai_category_id).toBe(categoriaDoLar(lar, "presentes"));
    expect((await lerTransacao(p4)).category_id).toBe(LAZER(lar));
    expect((await lerTransacao(p4)).categorized_by).toBe(lar.memberId);
    expect((await lerTransacao(origem)).category_id).toBeNull();
  });
});

describe("validação: 422 com o campo e a mensagem da spec", () => {
  it("cenário 5: compra no cartão nunca vira Metas nem Investimentos", async () => {
    const lar = await criarLar();
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] LOJA CINCO",
    });
    const resposta = await chamar(appDoLar(lar), "POST", "/api/rules", {
      transactionId: compra,
      set: { spendType: "investimentos" },
      createdFrom: "lembrar",
    });
    expect(resposta.status).toBe(422);
    expect(resposta.corpo).toEqual({
      error: "validacao",
      fields: { spendType: "Compra no cartão nunca é Metas nem Investimentos." },
    });
    expect(await contar("SELECT COUNT(*) AS total FROM rules")).toBe(0);
  });

  it("Pix sem nome nem documento não vira regra", async () => {
    const lar = await criarLar();
    const pixVazio = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -100,
      descricao: "[TEST] Pix",
    });
    const resposta = await chamar(appDoLar(lar), "POST", "/api/rules", {
      transactionId: pixVazio,
      set: { categoryId: LAZER(lar) },
      createdFrom: "lembrar",
    });
    expect(resposta.status).toBe(422);
    expect(resposta.corpo.fields).toEqual({
      transactionId: "Esta transação não tem estabelecimento nem contraparte para lembrar.",
    });
  });

  it("categoria arquivada e inexistente: 'Categoria inválida.' no campo categoryId", async () => {
    const lar = await criarLar();
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] LOJA ARQ",
    });
    await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?").bind(AGORA, LAZER(lar)).run();
    const app = appDoLar(lar);

    const arquivada = await chamar(app, "PUT", `/api/transactions/${compra}/category`, {
      categoryId: LAZER(lar),
      applyToAll: false,
    });
    const inexistente = await chamar(app, "PUT", `/api/transactions/${compra}/category`, {
      categoryId: "nao-existe",
      applyToAll: true,
    });

    expect(arquivada.status).toBe(422);
    expect(arquivada.corpo.fields).toEqual({ categoryId: "Categoria inválida." });
    expect(inexistente.status).toBe(422);
    expect(inexistente.corpo.fields).toEqual({ categoryId: "Categoria inválida." });
    expect((await lerTransacao(compra)).category_id).toBeNull();
  });

  it("'Aplicar a todas' em Pix: 422 no campo applyToAll, e nada é gravado", async () => {
    const lar = await criarLar();
    const pixId = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -100,
      descricao: "[TEST] Pix",
      contraparte: "[TEST] Joana",
      doc: "***.111.222-**",
    });
    const resposta = await chamar(appDoLar(lar), "PUT", `/api/transactions/${pixId}/category`, {
      categoryId: LAZER(lar),
      applyToAll: true,
    });
    expect(resposta.status).toBe(422);
    expect(resposta.corpo.fields).toEqual({ applyToAll: "'Aplicar a todas' só vale para compras." });
    expect((await lerTransacao(pixId)).category_id).toBeNull();
    expect(await contar("SELECT COUNT(*) AS total FROM rules")).toBe(0);
  });

  it("'Aplicar a todas' sem categoria e corpo inválido: 422 e 400", async () => {
    const lar = await criarLar();
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] LOJA VAZIA",
    });
    const app = appDoLar(lar);
    const semSet = await chamar(app, "POST", "/api/rules", {
      transactionId: compra,
      set: {},
      createdFrom: "lembrar",
    });
    const corpoInvalido = await chamar(app, "PUT", `/api/transactions/${compra}/category`, {
      categoryId: LAZER(lar),
    });

    expect(semSet.status).toBe(422);
    expect(semSet.corpo.fields).toEqual({ set: "Escolha uma categoria, um tipo ou um nome." });
    expect(corpoInvalido.status).toBe(400);
  });
});

describe("mescla, desativação e retroativo: cenários 10 e 11", () => {
  it("cenário 10: regra de categoria e depois só nome para o mesmo alvo: a ativa tem as duas coisas e a antiga fica desativada", async () => {
    const lar = await criarLar();
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] LOJA MESCLA",
    });
    const app = appDoLar(lar);
    const primeira = await chamar(app, "POST", "/api/rules", {
      transactionId: compra,
      set: { categoryId: SERVICOS(lar) },
      createdFrom: "lembrar",
    });
    const segunda = await chamar(app, "POST", "/api/rules", {
      transactionId: compra,
      set: { customName: "[TEST] Loja da mescla" },
      createdFrom: "lembrar",
    });

    expect(segunda.status).toBe(201);
    const ativa = await chamar(app, "GET", `/api/transactions/${compra}/categorization`);
    const rule = ativa.corpo.rule as { id: string; setCategoryId: string; setCustomName: string };
    expect(rule.id).not.toBe((primeira.corpo.rule as { id: string }).id);
    expect(rule.setCategoryId).toBe(SERVICOS(lar));
    expect(rule.setCustomName).toBe("[TEST] Loja da mescla");
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE match_value = ? AND disabled_at IS NOT NULL",
        "[TEST] LOJA MESCLA",
      ),
    ).toBe(1);
  });

  it("cenário 11: depois do DELETE, compras novas não casam; as antigas continuam com a categoria", async () => {
    const lar = await criarLar();
    const { antigas, aberta } = await cenarioDoJose(lar);
    const app = appDoLar(lar);
    const aplicada = await chamar(app, "PUT", `/api/transactions/${aberta}/category`, {
      categoryId: SERVICOS(lar),
      applyToAll: true,
    });
    const regraId = (aplicada.corpo.rule as { id: string }).id;

    const apagada = await chamar(app, "DELETE", `/api/rules/${regraId}`);
    expect(apagada.status).toBe(204);

    const [nova] = await importar(lar, [linhaCompra(lar, CHAVE_JOSE)]);
    expect((await lerTransacao(nova ?? "")).category_id).toBeNull();
    expect((await lerTransacao(antigas[0] ?? "")).category_id).toBe(SERVICOS(lar));
    expect((await chamar(app, "POST", `/api/rules/${regraId}/apply-retroactive`)).status).toBe(409);
  });

  it("regra inexistente no retroativo: 404", async () => {
    const lar = await criarLar();
    const resposta = await chamar(appDoLar(lar), "POST", "/api/rules/nao-existe/apply-retroactive");
    expect(resposta.status).toBe(404);
  });

  it("GET de categorização: escopo, rótulo, categoria, sugestão e regra; Pix tem o nome do destinatário como rótulo", async () => {
    const lar = await criarLar();
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "  [TEST] PAG*LEITURA  ",
      aiCategoryId: categoriaDoLar(lar, "presentes"),
    });
    const pixId = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -100,
      descricao: "[TEST] Pix",
      contraparte: "[TEST] Joana",
      doc: "***.111.222-**",
    });
    const app = appDoLar(lar);

    const doCompra = await chamar(app, "GET", `/api/transactions/${compra}/categorization`);
    const doPix = await chamar(app, "GET", `/api/transactions/${pixId}/categorization`);

    expect(doCompra.corpo).toEqual({
      transactionId: compra,
      scope: "estabelecimento",
      matchLabel: "[TEST] PAG*LEITURA",
      categoryId: null,
      aiCategoryId: categoriaDoLar(lar, "presentes"),
      rule: null,
    });
    expect(doPix.corpo.scope).toBe("destinatario");
    expect(doPix.corpo.matchLabel).toBe("[TEST] Joana");
    expect(doPix.corpo.rule).toBeNull();
  });
});

describe("custo das rotas (Meter e parâmetros)", () => {
  it("PUT com Aplicar a todas e POST com Lembrar: no máximo 2 chamadas e nenhum comando com mais de 100 parâmetros", async () => {
    const lar = await criarLar();
    const { aberta } = await cenarioDoJose(lar);
    const medidos: Meter[] = [];
    const espiado = espiaDeParametros(env.DB);
    const app = appDoLar(lar, medidos);

    const put = await chamar(
      app,
      "PUT",
      `/api/transactions/${aberta}/category`,
      { categoryId: SERVICOS(lar), applyToAll: true },
      { DB: espiado.env },
    );
    expect(put.status).toBe(200);
    const pixId = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -100,
      descricao: "[TEST] Pix custo",
      contraparte: "[TEST] Custo",
      doc: "***.999.888-**",
    });
    const post = await chamar(
      app,
      "POST",
      "/api/rules",
      { transactionId: pixId, set: { categoryId: LAZER(lar) }, createdFrom: "lembrar" },
      { DB: espiado.env },
    );
    expect(post.status).toBe(201);

    expect(medidos[0]?.calls).toBeLessThanOrEqual(2);
    expect(medidos[1]?.calls).toBeLessThanOrEqual(2);
    expect(espiado.maiorComando()).toBeLessThanOrEqual(100);
    console.info(
      `[medicao] PUT applyToAll: calls=${medidos[0]?.calls} statements=${medidos[0]?.statements} rowsRead=${medidos[0]?.rowsRead} rowsWritten=${medidos[0]?.rowsWritten}; POST lembrar: calls=${medidos[1]?.calls} statements=${medidos[1]?.statements} rowsRead=${medidos[1]?.rowsRead} rowsWritten=${medidos[1]?.rowsWritten}; maiorComando=${espiado.maiorComando()}`,
    );
  });
});
