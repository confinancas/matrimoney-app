import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdResponse } from "../../src/shared/household";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import { addMember, createHousehold, getHousehold } from "../../src/worker/household/repository";
import { aquecerOPortao, callApi, limparBanco, semearPronto } from "./helpers/app";

const db = createDb(env.DB, newMeter());

const PERCENTUAIS_PADRAO = {
  fixos: 35,
  conforto: 10,
  educacao: 5,
  extras: 5,
  metas: 10,
  prazeres: 10,
  investimentos: 25,
};

const criarLarDeUma = async () => {
  const { householdId, memberId } = await createHousehold(db, {
    brand: "matrimoney",
    titular: { name: "[TEST] Pessoa A", email: "pessoa-a@example.com" },
  });
  return { householdId, memberId };
};

const criarLarDeDuas = async () => {
  const { householdId, memberId: titularId } = await criarLarDeUma();
  const { memberId: conjugeId } = await addMember(db, householdId, {
    name: "[TEST] Pessoa B",
    email: "pessoa-b@example.com",
    role: "conjuge",
  });
  return { householdId, titularId, conjugeId };
};

// Chama a API com uma requisição crua, para o JSON inválido.
const chamaComTextoCru = async (app: ReturnType<typeof createApp>, texto: string): Promise<Response> => {
  const ctx = createExecutionContext();
  const resposta = await app.fetch(
    new Request("http://matrimoney.test/api/household", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: texto,
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return resposta;
};

beforeEach(async () => {
  await limparBanco(env.DB);
  // O portão deixa passar as rotas do lar só com a instalação pronta.
  await semearPronto(env.DB);
});

describe("GET /api/household", () => {
  it("lar de uma pessoa: members tem um item com isMe verdadeiro, sem e-mail", async () => {
    const { householdId, memberId } = await criarLarDeUma();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await callApi(app, "GET", "/api/household");

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as HouseholdResponse;
    expect(corpo).toEqual({
      household: {
        id: householdId,
        brand: "matrimoney",
        cycleStartDay: 11,
        percentages: PERCENTUAIS_PADRAO,
        paidPlan: false,
        createdAt: expect.any(String),
      },
      members: [{ id: memberId, name: "[TEST] Pessoa A", role: "titular", isMe: true }],
    });
    expect(new Date(corpo.household.createdAt).toISOString()).toBe(corpo.household.createdAt);
    expect(JSON.stringify(corpo)).not.toContain("example.com");
  });

  it("lar de duas, vista pelo cônjuge: titular primeiro, isMe só no cônjuge", async () => {
    const { householdId, titularId, conjugeId } = await criarLarDeDuas();
    const app = createApp({ resolveSession: async () => ({ memberId: conjugeId, householdId }) });

    const corpo = (await (await callApi(app, "GET", "/api/household")).json()) as HouseholdResponse;

    expect(corpo.members).toEqual([
      { id: titularId, name: "[TEST] Pessoa A", role: "titular", isMe: false },
      { id: conjugeId, name: "[TEST] Pessoa B", role: "conjuge", isMe: true },
    ]);
  });

  it("lar inexistente devolve 404 lar_inexistente", async () => {
    const app = createApp({
      resolveSession: async () => ({
        memberId: "[TEST] pessoa-fantasma",
        householdId: "[TEST] lar-fantasma",
      }),
    });

    const resposta = await callApi(app, "GET", "/api/household");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "lar_inexistente" });
  });
});

describe("autenticação do lar", () => {
  it("sem sessão, GET e PATCH devolvem 401 nao_autenticado e não tocam no D1", async () => {
    const medidas: Meter[] = [];
    const app = createApp({ onMeter: (meter) => medidas.push({ ...meter }) });
    await aquecerOPortao(app);
    medidas.length = 0;

    const get = await callApi(app, "GET", "/api/household");
    const patch = await callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 });

    for (const resposta of [get, patch]) {
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual({
        error: "nao_autenticado",
        message: "Entre de novo para continuar.",
      });
    }
    expect(medidas.map((m) => m.calls)).toEqual([0, 0]);
  });

  it("com a sessão já posta por um middleware anterior, o resolvedor não é chamado", async () => {
    const { householdId, memberId } = await criarLarDeUma();
    const resolver = vi.fn(async () => null);
    const app = createApp({
      resolveSession: resolver,
      rotasDoApp: (rotas) => {
        rotas.use("*", async (c, next) => {
          c.set("session", { memberId, householdId });
          await next();
        });
      },
    });

    const resposta = await callApi(app, "GET", "/api/household");

    expect(resposta.status).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/household", () => {
  const sessaoDoTitular = async () => {
    const { householdId, memberId } = await criarLarDeUma();
    return { householdId, memberId };
  };

  it("mudança parcial: só o dia do ciclo muda", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as HouseholdResponse;
    expect(corpo.household.cycleStartDay).toBe(5);
    expect(corpo.household.percentages).toEqual(PERCENTUAIS_PADRAO);
  });

  it("percentuais que somam 80 são aceitos e investimentos sobra 20", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await callApi(app, "PATCH", "/api/household", {
      percentages: { fixos: 30, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 20 },
    });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as HouseholdResponse;
    expect(corpo.household.percentages.investimentos).toBe(20);
  });

  it("percentuais que somam 101 são recusados com a mensagem da soma, e nada muda", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    const resposta = await callApi(app, "PATCH", "/api/household", {
      percentages: { fixos: 36, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 35 },
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { percentages: "A soma dos tipos de gasto passa de 100%. Reduza algum para continuar." },
    });
    expect(medidas.at(-1)?.calls).toBe(0);
    const lar = await getHousehold(db, householdId);
    expect(lar?.household.percentages).toEqual(PERCENTUAIS_PADRAO);
  });

  it("investimentos enviado é recusado com dados_invalidos", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await callApi(app, "PATCH", "/api/household", {
      percentages: { ...PERCENTUAIS_PADRAO, investimentos: 25 },
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: "dados_invalidos", message: "Dados inválidos." });
  });

  it("percentuais com uma chave faltando (metas) são recusados em fields.percentages", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await callApi(app, "PATCH", "/api/household", {
      percentages: { fixos: 35, conforto: 10, educacao: 5, extras: 5, prazeres: 10 },
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { percentages: "Cada tipo de gasto vai de 0% a 100%, em números inteiros." },
    });
  });

  it("JSON inválido é recusado com dados_invalidos", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });

    const resposta = await chamaComTextoCru(app, "{nao e json");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: "dados_invalidos", message: "Dados inválidos." });
  });

  it("fronteiras do ciclo: 1 e 28 são aceitos; 0, 29 e 11.5 são recusados em fields.cycleStartDay", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });
    const mensagem = "O ciclo começa entre o dia 1 e o dia 28.";

    for (const dia of [1, 28]) {
      const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: dia });
      expect(resposta.status).toBe(200);
    }
    for (const dia of [0, 29, 11.5]) {
      const resposta = await callApi(app, "PATCH", "/api/household", { cycleStartDay: dia });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ error: "validacao", fields: { cycleStartDay: mensagem } });
    }
  });

  it("patch vazio é recusado com nada_para_salvar", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    const resposta = await callApi(app, "PATCH", "/api/household", {});

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: "nada_para_salvar", message: "Nada para salvar." });
    expect(medidas.at(-1)?.calls).toBe(0);
  });

  it("dois PATCHs ao mesmo tempo: as duas mudanças ficam gravadas", async () => {
    const { householdId, memberId } = await sessaoDoTitular();
    const app = createApp({ resolveSession: async () => ({ memberId, householdId }) });
    const novosPercentuais = { fixos: 40, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 };

    const [primeira, segunda] = await Promise.all([
      callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 }),
      callApi(app, "PATCH", "/api/household", { percentages: novosPercentuais }),
    ]);

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    const lar = await getHousehold(db, householdId);
    expect(lar?.household.cycleStartDay).toBe(5);
    expect(lar?.household.percentages).toMatchObject(novosPercentuais);
  });
});

describe("chamadas ao D1", () => {
  it("GET e PATCH de percentuais fazem uma chamada cada", async () => {
    const { householdId, memberId } = await criarLarDeUma();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    await callApi(app, "GET", "/api/household");
    expect(medidas.at(-1)?.calls).toBe(1);

    await callApi(app, "PATCH", "/api/household", {
      percentages: { fixos: 40, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 },
    });
    expect(medidas.at(-1)?.calls).toBe(1);
  });

  // TASK-0801: mudar o dia de início lê o calendário, grava o dia (e o calendário, se houver) e grava o lar.
  // Sem calendário: leitura, gravação do dia e gravação do lar. Medido pelo Meter.
  it("PATCH que muda o dia de início faz três chamadas, sem calendário", async () => {
    const { householdId, memberId } = await criarLarDeUma();
    const medidas: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ memberId, householdId }),
      onMeter: (meter) => medidas.push({ ...meter }),
    });
    await aquecerOPortao(app);
    medidas.length = 0;

    await callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 });
    expect(medidas.at(-1)?.calls).toBe(3);
  });
});
