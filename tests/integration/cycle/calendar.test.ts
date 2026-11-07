import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, type Ciclo, cycleForDate } from "../../../src/shared/cycle";
import { createApp } from "../../../src/worker/app";
import { assignCycleKeysStmts } from "../../../src/worker/cycle/assign";
import {
  assignCycleKeys,
  ensureCalendar,
  getCycleForDate,
  loadCalendar,
  rebuildFutureCalendar,
} from "../../../src/worker/cycle/calendar";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import { aquecerOPortao, callApi, semearPronto } from "../helpers/app";

const AGORA = "2026-11-10T12:00:00.000Z";
const HOJE = "2026-11-07";

const dbComMedidor = (medidor: Meter = newMeter()): Db => createDb(env.DB, medidor);

beforeEach(async () => {
  await semearPronto(env.DB);
});

// D1 que conta os parâmetros de cada comando (sem mudar o que executa). O teste de custo lê o maior número.
function d1Espiado(registro: { maiorComando: number }): D1Database {
  const d1 = env.DB;
  return {
    prepare: (sql: string) => {
      const comando = d1.prepare(sql);
      return {
        bind: (...valores: unknown[]) => {
          registro.maiorComando = Math.max(registro.maiorComando, valores.length);
          return comando.bind(...valores);
        },
      } as unknown as D1PreparedStatement;
    },
    batch: (comandos: D1PreparedStatement[]) => d1.batch(comandos),
  } as unknown as D1Database;
}

function geradorCom(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function criarLar(dia = 11): Promise<{ householdId: string; connectionId: string; memberId: string }> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO households (id, brand, cycle_start_day, created_at) VALUES (?, 'matrimoney', ?, ?)",
    ).bind(householdId, dia, AGORA),
    env.DB.prepare(
      "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, '[TEST] Pessoa', 'titular', ?)",
    ).bind(memberId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
  ]);
  return { householdId, connectionId, memberId };
}

async function criarItemEConta(connectionId: string): Promise<{ itemId: string; contaId: string }> {
  const itemId = crypto.randomUUID();
  const contaId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
  )
    .bind(itemId, connectionId, AGORA)
    .run();
  await env.DB.prepare(
    "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
  )
    .bind(contaId, itemId, AGORA)
    .run();
  return { itemId, contaId };
}

const SQL_LINHA = `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement,
  occurred_at, local_date, amount_cents, original_description, last_seen_at, hidden)
  VALUES (?, ?, ?, ?, ?, 'compra', ?, ?, -100, '[TEST] Compra', ?, 0)`;

async function inserirContaCorrente(
  db: Db,
  householdId: string,
  itemId: string,
  contaId: string,
  linhas: { id: string; data: string }[],
): Promise<void> {
  const comandos = linhas.map((linha) =>
    db.$client
      .prepare(SQL_LINHA)
      .bind(
        linha.id,
        householdId,
        `[TEST] ext-${linha.id}`,
        itemId,
        contaId,
        `${linha.data}T12:00:00.000Z`,
        linha.data,
        AGORA,
      ),
  );
  for (let i = 0; i < comandos.length; i += 50) await db.$client.batch(comandos.slice(i, i + 50));
}

const cicloDe = async (id: string): Promise<string | null> => {
  const linha = await env.DB.prepare("SELECT cycle_key FROM transactions WHERE id = ?")
    .bind(id)
    .first<{ cycle_key: string | null }>();
  return linha?.cycle_key ?? null;
};

const calendarioDoBanco = async (householdId: string): Promise<Ciclo[]> => {
  const { results } = await env.DB.prepare(
    "SELECT key, starts_on, ends_on FROM cycles WHERE household_id = ? ORDER BY starts_on",
  )
    .bind(householdId)
    .all<{ key: string; starts_on: string; ends_on: string }>();
  return results.map((linha) => ({ key: linha.key, startsOn: linha.starts_on, endsOn: linha.ends_on }));
};

// Cenário 10: o ciclo atual é de 11/10 a 10/11; o dia novo é 5. Lançamentos antes e depois de 10/11.
async function cenarioDaMudanca(): Promise<{
  householdId: string;
  connectionId: string;
  memberId: string;
  db: Db;
}> {
  const lar = await criarLar(11);
  const db = dbComMedidor();
  const { itemId, contaId } = await criarItemEConta(lar.connectionId);
  await ensureCalendar(db, lar.householdId, "2026-09-01", "2027-02-28");
  await inserirContaCorrente(db, lar.householdId, itemId, contaId, [
    { id: "[TEST] antes", data: "2026-10-05" },
    { id: "[TEST] nov12", data: "2026-11-12" },
    { id: "[TEST] dez06", data: "2026-12-06" },
    { id: "[TEST] jan07", data: "2027-01-07" },
    { id: "[TEST] fev07", data: "2027-02-07" },
  ]);
  await db.$client.batch(assignCycleKeysStmts(db, lar.householdId, { all: true }));
  return { ...lar, db };
}

const ESPERADO_APOS_MUDANCA = [
  { key: "2026-08", startsOn: "2026-08-11", endsOn: "2026-09-10" },
  { key: "2026-09", startsOn: "2026-09-11", endsOn: "2026-10-10" },
  { key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" },
  { key: "2026-11", startsOn: "2026-11-11", endsOn: "2026-12-04" },
  { key: "2026-12", startsOn: "2026-12-05", endsOn: "2027-01-04" },
  { key: "2027-01", startsOn: "2027-01-05", endsOn: "2027-02-04" },
  { key: "2027-02", startsOn: "2027-02-05", endsOn: "2027-03-04" },
  { key: "2027-03", startsOn: "2027-03-05", endsOn: "2027-04-04" },
];

function verificaMudanca(calendario: Ciclo[], chaves: Record<string, string | null>): void {
  expect(calendario).toEqual(ESPERADO_APOS_MUDANCA);
  expect(chaves).toEqual({
    "[TEST] antes": "2026-09",
    "[TEST] nov12": "2026-11",
    "[TEST] dez06": "2026-12",
    "[TEST] jan07": "2027-01",
    "[TEST] fev07": "2027-02",
  });
}

async function chavesDoCenario(): Promise<Record<string, string | null>> {
  const ids = ["[TEST] antes", "[TEST] nov12", "[TEST] dez06", "[TEST] jan07", "[TEST] fev07"];
  const saida: Record<string, string | null> = {};
  for (const id of ids) saida[id] = await cicloDe(id);
  return saida;
}

describe("ensureCalendar e loadCalendar", () => {
  it("cria o calendário que cobre o intervalo, é idempotente, e a segunda chamada só lê", async () => {
    const { householdId } = await criarLar(11);
    const db = dbComMedidor();

    await ensureCalendar(db, householdId, "2026-10-20", "2026-12-20");
    const primeiro = await loadCalendar(db, householdId);
    expect(primeiro.map((c) => c.key)).toEqual(["2026-10", "2026-11", "2026-12"]);

    const medidor = newMeter();
    await ensureCalendar(dbComMedidor(medidor), householdId, "2026-10-20", "2026-12-20");
    expect(medidor.calls).toBe(1);
    expect(await loadCalendar(db, householdId)).toEqual(primeiro);
    expect(await getCycleForDate(db, householdId, "2026-11-10")).toEqual({
      key: "2026-10",
      startsOn: "2026-10-11",
      endsOn: "2026-11-10",
    });
  });

  it("uma data antes do primeiro ciclo cria os ciclos para trás, com chaves contíguas", async () => {
    const { householdId } = await criarLar(11);
    const db = dbComMedidor();
    await ensureCalendar(db, householdId, "2026-11-01", "2026-11-30");
    await ensureCalendar(db, householdId, "2026-06-15", "2026-11-30");
    const calendario = await loadCalendar(db, householdId);
    // O primeiro ensure foi até 30/11, então já tem 10 e 11; o segundo acrescenta de 06 a 09 (para trás, até 15/06).
    expect(calendario.map((c) => c.key)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    for (let i = 1; i < calendario.length; i++) {
      expect(calendario[i]?.startsOn).toBe(addDays(calendario[i - 1]?.endsOn ?? "", 1));
    }
  });
});

describe("rebuildFutureCalendar: o cenário 10 (dia 11 vira 5)", () => {
  it("o ciclo atual fica; os futuros são refeitos; só os lançamentos que mudaram são reatribuídos; tudo num batch", async () => {
    const { householdId, db } = await cenarioDaMudanca();
    const medidor = newMeter();
    await rebuildFutureCalendar(dbComMedidor(medidor), householdId, 5, HOJE);

    verificaMudanca(await calendarioDoBanco(householdId), await chavesDoCenario());
    expect(await getCycleForDate(db, householdId, "2026-11-11")).toMatchObject({
      key: "2026-11",
      endsOn: "2026-12-04",
    });
    // Leitura do calendário e um batch de escrita: duas idas, com todas as escritas dentro delas.
    expect(medidor.calls).toBe(2);
  });

  it("o mesmo dia não reconstrói nada: uma ida, e o calendário fica igual", async () => {
    const { householdId } = await cenarioDaMudanca();
    const antes = await calendarioDoBanco(householdId);
    const medidor = newMeter();
    await rebuildFutureCalendar(dbComMedidor(medidor), householdId, 11, HOJE);
    expect(medidor.calls).toBe(1);
    expect(medidor.rowsWritten).toBe(0);
    expect(await calendarioDoBanco(householdId)).toEqual(antes);
  });

  it("sem calendário, só o dia muda; nenhum ciclo é criado", async () => {
    const { householdId } = await criarLar(11);
    const db = dbComMedidor();
    await rebuildFutureCalendar(db, householdId, 5, HOJE);
    expect(await loadCalendar(db, householdId)).toEqual([]);
    const lar = await env.DB.prepare("SELECT cycle_start_day FROM households WHERE id = ?")
      .bind(householdId)
      .first<{ cycle_start_day: number }>();
    expect(lar?.cycle_start_day).toBe(5);
  });

  it("hoje fora do calendário: o que falta até hoje entra com o dia antigo, e o calendário segue contíguo", async () => {
    const { householdId } = await criarLar(11);
    const db = dbComMedidor();
    await ensureCalendar(db, householdId, "2026-01-01", "2026-03-31");
    await rebuildFutureCalendar(db, householdId, 5, HOJE);

    const calendario = await loadCalendar(db, householdId);
    expect(calendario[calendario.length - 1]?.endsOn).toBe("2026-11-10");
    expect(await getCycleForDate(db, householdId, HOJE)).toMatchObject({ key: "2026-10" });
    for (let i = 1; i < calendario.length; i++) {
      expect(calendario[i]?.startsOn).toBe(addDays(calendario[i - 1]?.endsOn ?? "", 1));
    }
    // Depois da mudança, o calendário que se cria para a frente usa o dia novo.
    await ensureCalendar(db, householdId, "2026-11-11", "2026-12-06");
    expect(await getCycleForDate(db, householdId, "2026-12-05")).toEqual({
      key: "2026-12",
      startsOn: "2026-12-05",
      endsOn: "2027-01-04",
    });
  });
});

describe("PATCH /api/household com mudança do dia de início", () => {
  it("cenário 10 pela rota: o dia novo vale a partir do próximo ciclo, e o resto fica como estava", async () => {
    const { householdId, memberId, db } = await cenarioDaMudanca();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      agora: () => new Date("2026-11-07T15:00:00.000Z"),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 });

    expect(resposta.status).toBe(200);
    expect(
      ((await resposta.json()) as { household: { cycleStartDay: number } }).household.cycleStartDay,
    ).toBe(5);
    verificaMudanca(await calendarioDoBanco(householdId), await chavesDoCenario());
    expect(await getCycleForDate(db, householdId, HOJE)).toMatchObject({
      key: "2026-10",
      endsOn: "2026-11-10",
    });
    // Leitura do dia e do calendário, escrita, e a gravação do lar: três idas.
    expect(medidas.at(-1)?.calls).toBe(3);
  });

  it("dia igual ao atual: nada é reconstruído (duas idas: a leitura do dia e a gravação do lar)", async () => {
    const { householdId, memberId } = await cenarioDaMudanca();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      agora: () => new Date("2026-11-07T15:00:00.000Z"),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;
    const antes = await calendarioDoBanco(householdId);

    const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: 11 });

    expect(resposta.status).toBe(200);
    expect(await calendarioDoBanco(householdId)).toEqual(antes);
    expect(medidas.at(-1)?.calls).toBe(2);
  });

  it("só percentuais: nenhuma reconstrução, uma ida", async () => {
    const { householdId, memberId } = await cenarioDaMudanca();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      agora: () => new Date("2026-11-07T15:00:00.000Z"),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    await callApi(app, "PATCH", "/api/household", {
      percentages: { fixos: 40, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 },
    });

    expect(medidas.at(-1)?.calls).toBe(1);
  });
});

describe("transição mínima pela rota (28 → 1, hoje 15/11/2026)", () => {
  it("o calendário pula 2026-12; 28/11 e 15/12 ficam em 2026-11; 02/01 vai para 2027-01; nada que começa até 27/11 muda", async () => {
    const lar = await criarLar(28);
    const db = dbComMedidor();
    const { itemId, contaId } = await criarItemEConta(lar.connectionId);
    await ensureCalendar(db, lar.householdId, "2026-09-01", "2027-02-28");
    await inserirContaCorrente(db, lar.householdId, itemId, contaId, [
      { id: "[TEST] out05", data: "2026-10-05" },
      { id: "[TEST] nov10", data: "2026-11-10" },
      { id: "[TEST] nov28", data: "2026-11-28" },
      { id: "[TEST] dez15", data: "2026-12-15" },
      { id: "[TEST] jan02", data: "2027-01-02" },
    ]);
    await db.$client.batch(assignCycleKeysStmts(db, lar.householdId, { all: true }));
    const antes = await calendarioDoBanco(lar.householdId);
    expect(await cicloDe("[TEST] jan02")).toBe("2026-12");

    const app = createApp({
      resolveSession: async () => ({ memberId: lar.memberId, householdId: lar.householdId }),
      agora: () => new Date("2026-11-15T15:00:00.000Z"),
    });
    const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: 1 });
    expect(resposta.status).toBe(200);

    const depois = await calendarioDoBanco(lar.householdId);
    expect(depois.map((c) => c.key)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(depois.find((c) => c.key === "2026-11")).toEqual({
      key: "2026-11",
      startsOn: "2026-11-28",
      endsOn: "2026-12-31",
    });
    expect(depois.find((c) => c.key === "2027-01")).toEqual({
      key: "2027-01",
      startsOn: "2027-01-01",
      endsOn: "2027-01-31",
    });
    expect(depois.filter((c) => c.startsOn <= "2026-11-27")).toEqual(
      antes.filter((c) => c.startsOn <= "2026-11-27"),
    );

    expect(await cicloDe("[TEST] out05")).toBe("2026-09");
    expect(await cicloDe("[TEST] nov10")).toBe("2026-10");
    expect(await cicloDe("[TEST] nov28")).toBe("2026-11");
    expect(await cicloDe("[TEST] dez15")).toBe("2026-11");
    expect(await cicloDe("[TEST] jan02")).toBe("2027-01");
  });
});

describe("custo pelo Meter", () => {
  it("PATCH com mudança do dia e 2.000 lançamentos [TEST]: poucas idas e nenhum comando com mais de 100 parâmetros", async () => {
    const lar = await criarLar(11);
    const db = dbComMedidor();
    const { itemId, contaId } = await criarItemEConta(lar.connectionId);
    await ensureCalendar(db, lar.householdId, "2026-08-01", "2027-03-31");
    const rnd = geradorCom(2026);
    const linhas: { id: string; data: string }[] = [];
    for (let i = 0; i < 2000; i++) {
      const dias = Math.floor(rnd() * 210);
      linhas.push({ id: `[TEST] lote-${i}`, data: addDays("2026-08-15", dias) });
    }
    await inserirContaCorrente(db, lar.householdId, itemId, contaId, linhas);
    await db.$client.batch(assignCycleKeysStmts(db, lar.householdId, { all: true }));

    const registro = { maiorComando: 0 };
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId: lar.memberId, householdId: lar.householdId }),
      agora: () => new Date("2026-11-07T15:00:00.000Z"),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;
    const ctx = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    const env2 = { ...env, DB: d1Espiado(registro) };
    const resposta = await app.fetch(
      new Request("http://matrimoney.test/api/household", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cycleStartDay: 5 }),
      }),
      env2,
      ctx,
    );

    expect(resposta.status).toBe(200);
    const medida = medidas.at(-1);
    expect(medida?.calls).toBeLessThanOrEqual(50);
    expect(registro.maiorComando).toBeLessThanOrEqual(100);
  });

  it("passo 2 com 200 lançamentos: uma ida com o calendário pronto, e duas quando cria o calendário; nenhum comando com mais de 100 parâmetros", async () => {
    const lar = await criarLar(11);
    const db = dbComMedidor();
    const { itemId, contaId } = await criarItemEConta(lar.connectionId);
    const linhas = Array.from({ length: 200 }, (_, i) => ({
      id: `[TEST] passo2-${i}`,
      data: addDays("2026-10-01", i % 60),
    }));
    await inserirContaCorrente(db, lar.householdId, itemId, contaId, linhas);
    const ids = linhas.map((linha) => linha.id);

    const registroSem = { maiorComando: 0 };
    const sem = newMeter();
    await assignCycleKeys(createDb(d1Espiado(registroSem), sem), lar.householdId, ids);
    expect(sem.calls).toBe(2);
    expect(registroSem.maiorComando).toBeLessThanOrEqual(100);
    // O primeiro lançamento é de 01/10, que cai no ciclo de setembro (o calendário começa em 11/09).
    expect(await cicloDe(ids[0] ?? "")).toBe("2026-09");

    const registroCom = { maiorComando: 0 };
    const com = newMeter();
    await assignCycleKeys(createDb(d1Espiado(registroCom), com), lar.householdId, ids);
    expect(com.calls).toBe(1);
    expect(com.rowsWritten).toBe(0);
    expect(registroCom.maiorComando).toBeLessThanOrEqual(100);

    // Chaves e datas batem com cycleForDate, para todos os 200.
    const calendario = await calendarioDoBanco(lar.householdId);
    for (const linha of linhas) {
      expect(await cicloDe(linha.id)).toBe(cycleForDate(linha.data, calendario)?.key);
    }
  });
});

describe("cardIds: o escopo dos cartões", () => {
  it("atribui só os lançamentos e as faturas dos cartões dados", async () => {
    const lar = await criarLar(11);
    const db = dbComMedidor();
    await ensureCalendar(db, lar.householdId, "2026-09-01", "2026-12-31");
    const { itemId } = await criarItemEConta(lar.connectionId);
    const cartaoA = crypto.randomUUID();
    const cartaoB = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '1111', '[TEST] Cartão A')",
      ).bind(cartaoA, itemId),
      env.DB.prepare(
        "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '2222', '[TEST] Cartão B')",
      ).bind(cartaoB, itemId),
      env.DB.prepare(
        "INSERT INTO bills (id, card_id, closes_on, status) VALUES ('[TEST] fa', ?, '2026-11-03', 'fechada')",
      ).bind(cartaoA),
      env.DB.prepare(
        "INSERT INTO bills (id, card_id, closes_on, status) VALUES ('[TEST] fb', ?, '2026-11-03', 'fechada')",
      ).bind(cartaoB),
      env.DB.prepare(
        "INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, last_seen_at) VALUES ('[TEST] ta', ?, '[TEST] xa', ?, ?, '[TEST] fa', 'compra', ?, '2026-10-05', -100, '[TEST] A', ?)",
      ).bind(lar.householdId, itemId, cartaoA, AGORA, AGORA),
      env.DB.prepare(
        "INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, last_seen_at) VALUES ('[TEST] tb', ?, '[TEST] xb', ?, ?, '[TEST] fb', 'compra', ?, '2026-10-05', -100, '[TEST] B', ?)",
      ).bind(lar.householdId, itemId, cartaoB, AGORA, AGORA),
    ]);

    await db.$client.batch(assignCycleKeysStmts(db, lar.householdId, { cardIds: [cartaoA] }));

    expect(await cicloDe("[TEST] ta")).toBe("2026-10");
    expect(await cicloDe("[TEST] tb")).toBeNull();
    const faturaA = await env.DB.prepare("SELECT cycle_key FROM bills WHERE id = '[TEST] fa'").first<{
      cycle_key: string;
    }>();
    const faturaB = await env.DB.prepare("SELECT cycle_key FROM bills WHERE id = '[TEST] fb'").first<{
      cycle_key: string | null;
    }>();
    expect(faturaA?.cycle_key).toBe("2026-10");
    expect(faturaB?.cycle_key).toBeNull();
  });
});
