import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CategoryDTO } from "../../src/shared/categories";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import { createHousehold } from "../../src/worker/household/repository";
import { aquecerOPortao, callApi, limparBanco, semearPronto } from "./helpers/app";

type App = ReturnType<typeof createApp>;

const db = createDb(env.DB, newMeter());

const ORDEM_DA_SEMENTE = [
  "Assinaturas",
  "Casa e contas",
  "Cuidados pessoais",
  "Educação",
  "Lazer",
  "Mercado",
  "Presentes",
  "Restaurantes e delivery",
  "Saúde",
  "Academia",
  "Farmácia",
  "Serviços",
  "Transporte",
  "Manutenção do carro",
  "Outros",
];

// Um lar com a sessão dele: o lar de teste é criado pelo repositório (só cabe um por instalação).
async function criarLar(): Promise<{ householdId: string; memberId: string }> {
  return createHousehold(db, {
    brand: "matrimoney",
    titular: { name: "[TEST] Pessoa A", email: "pessoa-a@example.com" },
  });
}

// Um segundo lar, direto no D1 (o repositório aceita um lar só).
async function criarOutroLar(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)")
    .bind(id, new Date().toISOString())
    .run();
  return id;
}

const appDoLar = (householdId: string, memberId: string, onMeter?: (meter: Meter) => void): App =>
  createApp({
    resolveSession: async () => ({ memberId, householdId }),
    onMeter: onMeter ? (meter) => onMeter({ ...meter }) : undefined,
  });

async function listar(app: App, incluirArquivadas = false): Promise<CategoryDTO[]> {
  const caminho = incluirArquivadas ? "/api/categories?incluirArquivadas=1" : "/api/categories";
  const corpo = (await (await callApi(app, "GET", caminho)).json()) as { categories: CategoryDTO[] };
  return corpo.categories;
}

function achar(lista: CategoryDTO[], nome: string): CategoryDTO {
  const categoria = lista.find((candidata) => candidata.name === nome);
  if (!categoria) throw new Error(`categoria ${nome} não encontrada`);
  return categoria;
}

const SEMPRE_VALIDA = {
  name: "[TEST] Pet",
  color: "#F0559A",
  parentId: null,
  aiHint: null,
  defaultSpendType: null,
};

beforeEach(async () => {
  await limparBanco(env.DB);
  // Instalação pronta, para o portão deixar passar as rotas; o aquecimento põe "pronto" no cache,
  // assim as medidas de D1 contam só o que a rota faz.
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

describe("GET /api/categories: semente", () => {
  it("lar sem categorias: a primeira leitura traz as 15 da semente, na ordem, com subcategorias abaixo da principal", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);

    const lista = await listar(app);

    expect(lista.map((categoria) => categoria.name)).toEqual(ORDEM_DA_SEMENTE);
    expect(achar(lista, "Outros").sort).toBe(1);
    expect(achar(lista, "Academia").parentId).toBe(achar(lista, "Saúde").id);
    expect(achar(lista, "Saúde").id).toBe(`seed:${householdId}:saude`);
  });

  it("duas leituras ao mesmo tempo: o lar fica com exatamente 15 categorias", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);

    const [primeira, segunda] = await Promise.all([listar(app), listar(app)]);
    expect(primeira).toHaveLength(15);
    expect(segunda).toHaveLength(15);

    expect(await listar(app)).toHaveLength(15);
  });

  it("arquivar tudo e abrir de novo não semeia de novo: a lista vem vazia, e 'Nova categoria' segue disponível", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const lista = await listar(app);
    for (const principal of lista.filter((categoria) => categoria.parentId === null)) {
      const resposta = await callApi(app, "PATCH", `/api/categories/${principal.id}`, { archived: true });
      expect(resposta.status).toBe(200);
    }

    expect(await listar(app)).toEqual([]);
    expect(await listar(app, true)).toHaveLength(15);
    expect((await callApi(app, "POST", "/api/categories", SEMPRE_VALIDA)).status).toBe(201);
  });

  it("incluirArquivadas=1 traz as arquivadas; sem o parâmetro, só as ativas", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    await listar(app);
    await callApi(app, "PATCH", `/api/categories/seed:${householdId}:mercado`, { archived: true });

    expect((await listar(app)).map((categoria) => categoria.name)).not.toContain("Mercado");
    const comArquivadas = await listar(app, true);
    expect(achar(comArquivadas, "Mercado").archived).toBe(true);
    expect(comArquivadas).toHaveLength(15);
  });
});

describe("POST /api/categories", () => {
  it("cria uma categoria com sort 0, sem espaços nas pontas da dica, e ela aparece na lista", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    await listar(app);

    const resposta = await callApi(app, "POST", "/api/categories", {
      ...SEMPRE_VALIDA,
      aiHint: "  [TEST] dica  ",
    });

    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as { category: CategoryDTO };
    expect(corpo.category).toMatchObject({
      name: "[TEST] Pet",
      color: "#F0559A",
      parentId: null,
      aiHint: "[TEST] dica",
      sort: 0,
      archived: false,
    });
    expect((await listar(app)).map((categoria) => categoria.id)).toContain(corpo.category.id);
  });

  it("primeiro uso pelo POST: a semente entra junto com a nova, e a lista fica com 16", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);

    expect((await callApi(app, "POST", "/api/categories", SEMPRE_VALIDA)).status).toBe(201);
    expect(await listar(app)).toHaveLength(16);
  });

  it("nome repetido, sem acento e sem caixa → 422 no nome; nada é gravado", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    await listar(app);

    const resposta = await callApi(app, "POST", "/api/categories", {
      ...SEMPRE_VALIDA,
      name: "Mércado",
      color: "#22B8E0",
    });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { name: "Já existe uma categoria com esse nome." },
    });
    expect(await listar(app)).toHaveLength(15);
  });

  it("subcategoria de uma subcategoria pela API → 422 'Escolha uma categoria principal.'", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const academia = achar(await listar(app), "Academia");

    const resposta = await callApi(app, "POST", "/api/categories", {
      ...SEMPRE_VALIDA,
      parentId: academia.id,
    });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { parentId: "Escolha uma categoria principal." },
    });
  });

  it("todas as falhas de campo voltam juntas: nome vazio, cor fora, dica longa e tipo inválido", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);

    const resposta = await callApi(app, "POST", "/api/categories", {
      name: "   ",
      color: "#000000",
      parentId: null,
      aiHint: "x".repeat(301),
      defaultSpendType: "nada",
    });

    expect(resposta.status).toBe(422);
    const corpo = (await resposta.json()) as { fields: Record<string, string> };
    expect(corpo.fields).toEqual({
      name: "Dê um nome à categoria.",
      color: "Escolha uma das cores.",
      aiHint: "Use até 300 caracteres.",
      defaultSpendType: "Tipo de gasto inválido.",
    });
  });

  it("nome com 41 caracteres → 422 'Use até 40 caracteres.'", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);

    const resposta = await callApi(app, "POST", "/api/categories", {
      ...SEMPRE_VALIDA,
      name: "a".repeat(41),
    });

    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { name: "Use até 40 caracteres." },
    });
  });

  it("JSON inválido ou campo que não existe → 400 dados_invalidos", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const ctx = createExecutionContext();
    const cru = await app.fetch(
      new Request("http://matrimoney.test/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{nao e json",
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(cru.status).toBe(400);

    const campoEstranho = await callApi(app, "POST", "/api/categories", { ...SEMPRE_VALIDA, sort: 9 });
    expect(campoEstranho.status).toBe(400);
    expect(await campoEstranho.json()).toEqual({ error: "dados_invalidos", message: "Dados inválidos." });
  });
});

describe("PATCH /api/categories/:id", () => {
  it("arquivar uma principal arquiva as subcategorias ativas no mesmo lote", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const saude = achar(await listar(app), "Saúde");

    const resposta = await callApi(app, "PATCH", `/api/categories/${saude.id}`, { archived: true });

    expect(resposta.status).toBe(200);
    const arquivadas = await listar(app, true);
    expect(achar(arquivadas, "Saúde").archived).toBe(true);
    expect(achar(arquivadas, "Academia").archived).toBe(true);
    expect(achar(arquivadas, "Farmácia").archived).toBe(true);
    expect((await listar(app)).map((categoria) => categoria.name)).not.toContain("Academia");
  });

  it("reativar uma subcategoria com a principal arquivada → 422 em archived", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const saude = achar(await listar(app), "Saúde");
    await callApi(app, "PATCH", `/api/categories/${saude.id}`, { archived: true });
    const farmacia = achar(await listar(app, true), "Farmácia");

    const resposta = await callApi(app, "PATCH", `/api/categories/${farmacia.id}`, { archived: false });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { archived: "Reative antes a categoria principal." },
    });
  });

  it("reativar com nome que agora é de outra ativa → 422 no nome", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const mercado = achar(await listar(app), "Mercado");
    await callApi(app, "PATCH", `/api/categories/${mercado.id}`, { archived: true });
    expect(
      (await callApi(app, "POST", "/api/categories", { ...SEMPRE_VALIDA, name: "Mercado" })).status,
    ).toBe(201);

    const resposta = await callApi(app, "PATCH", `/api/categories/${mercado.id}`, { archived: false });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { name: "Já existe uma categoria com esse nome." },
    });
  });

  it("editar mantendo o próprio nome não conta como repetido", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const mercado = achar(await listar(app), "Mercado");

    const resposta = await callApi(app, "PATCH", `/api/categories/${mercado.id}`, {
      name: "Mércado",
      color: "#F7931E",
    });

    expect(resposta.status).toBe(200);
    expect(achar(await listar(app), "Mércado").color).toBe("#F7931E");
  });

  it("PATCH com subconjunto valida o estado final: o nome que não veio continua valendo", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const lista = await listar(app);
    const casa = achar(lista, "Casa e contas");

    const resposta = await callApi(app, "PATCH", `/api/categories/${casa.id}`, { name: "Mercado" });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { name: "Já existe uma categoria com esse nome." },
    });
  });

  it("parentId da própria categoria → 422 'Escolha uma categoria principal.'", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const mercado = achar(await listar(app), "Mercado");

    const resposta = await callApi(app, "PATCH", `/api/categories/${mercado.id}`, { parentId: mercado.id });

    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { parentId: "Escolha uma categoria principal." },
    });
  });

  it("mover uma principal com subcategorias ativas para dentro de outra → 422 de um nível", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const lista = await listar(app);

    const resposta = await callApi(app, "PATCH", `/api/categories/${achar(lista, "Saúde").id}`, {
      parentId: achar(lista, "Mercado").id,
    });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { parentId: "Uma categoria com subcategorias não pode ficar dentro de outra." },
    });
  });

  it("editar o nome de uma subcategoria arquivada, com a principal arquivada, não é recusado", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const saude = achar(await listar(app), "Saúde");
    await callApi(app, "PATCH", `/api/categories/${saude.id}`, { archived: true });
    const academia = achar(await listar(app, true), "Academia");

    const resposta = await callApi(app, "PATCH", `/api/categories/${academia.id}`, { name: "Academia nova" });

    expect(resposta.status).toBe(200);
  });

  it("PATCH sem campos → 400 nada_para_salvar; campo que não existe → 400 dados_invalidos; id inexistente → 404", async () => {
    const { householdId, memberId } = await criarLar();
    const app = appDoLar(householdId, memberId);
    const mercado = achar(await listar(app), "Mercado");

    expect(await (await callApi(app, "PATCH", `/api/categories/${mercado.id}`, {})).json()).toEqual({
      error: "nada_para_salvar",
      message: "Nada para salvar.",
    });
    expect((await callApi(app, "PATCH", `/api/categories/${mercado.id}`, { sort: 3 })).status).toBe(400);
    expect(
      await (await callApi(app, "PATCH", "/api/categories/nao-existe", { archived: true })).json(),
    ).toEqual({
      error: "nao_encontrada",
    });
  });
});

describe("lares e sessão", () => {
  it("dois lares têm cada um a sua semente: mesmo nome, ids diferentes", async () => {
    const { householdId, memberId } = await criarLar();
    const outroLar = await criarOutroLar();
    const appA = appDoLar(householdId, memberId);
    const appB = createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro-b", householdId: outroLar }),
    });

    const doA = achar(await listar(appA), "Mercado");
    const doB = achar(await listar(appB), "Mercado");

    expect(doA.id).not.toBe(doB.id);
    expect(await listar(appB)).toHaveLength(15);
  });

  it("PATCH numa categoria de outro lar → 404 nao_encontrada, sem revelar, e a categoria segue como estava", async () => {
    const { householdId, memberId } = await criarLar();
    const outroLar = await criarOutroLar();
    const appA = appDoLar(householdId, memberId);
    const appB = createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro-b", householdId: outroLar }),
    });
    const doA = achar(await listar(appA), "Mercado");
    await listar(appB);

    const resposta = await callApi(appB, "PATCH", `/api/categories/${doA.id}`, { archived: true });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "nao_encontrada" });
    expect(achar(await listar(appA), "Mercado").archived).toBe(false);
  });

  it("pai de outro lar → 422 'Escolha uma categoria principal.'", async () => {
    const { householdId, memberId } = await criarLar();
    const outroLar = await criarOutroLar();
    const appA = appDoLar(householdId, memberId);
    const appB = createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro-b", householdId: outroLar }),
    });
    const saudeDeA = achar(await listar(appA), "Saúde");
    await listar(appB);

    const resposta = await callApi(appB, "POST", "/api/categories", {
      ...SEMPRE_VALIDA,
      parentId: saudeDeA.id,
    });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "validacao",
      fields: { parentId: "Escolha uma categoria principal." },
    });
  });

  it("sem sessão, GET, POST e PATCH devolvem 401 nao_autenticado e não tocam no D1", async () => {
    const medidas: Meter[] = [];
    const app = createApp({ onMeter: (meter) => medidas.push({ ...meter }) });

    const get = await callApi(app, "GET", "/api/categories");
    const post = await callApi(app, "POST", "/api/categories", SEMPRE_VALIDA);
    const patch = await callApi(app, "PATCH", "/api/categories/qualquer", { archived: true });

    for (const resposta of [get, post, patch]) {
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual({
        error: "nao_autenticado",
        message: "Entre de novo para continuar.",
      });
    }
    expect(medidas.map((meter) => meter.calls)).toEqual([0, 0, 0]);
  });
});

describe("chamadas ao D1 (Meter)", () => {
  it("GET na primeira vez: 3 chamadas e 17 comandos (leitura, semente em lote, leitura); depois, 1 chamada e 1 comando", async () => {
    const { householdId, memberId } = await criarLar();
    const medidas: Meter[] = [];
    const app = appDoLar(householdId, memberId, (meter) => medidas.push(meter));

    await listar(app);
    const primeira = medidas.at(-1);
    await listar(app);
    const depois = medidas.at(-1);

    expect(primeira).toMatchObject({ calls: 3, statements: 17 });
    expect(depois).toMatchObject({ calls: 1, statements: 1 });
  });

  it("POST num lar já semeado: 2 chamadas (leitura e lote) e 2 comandos", async () => {
    const { householdId, memberId } = await criarLar();
    const medidas: Meter[] = [];
    const app = appDoLar(householdId, memberId, (meter) => medidas.push(meter));
    await listar(app);

    await callApi(app, "POST", "/api/categories", SEMPRE_VALIDA);

    expect(medidas.at(-1)).toMatchObject({ calls: 2, statements: 2 });
  });

  // Leitura do lar (1 comando) + lote com o UPDATE da principal e o UPDATE das subcategorias por parent_id (2 comandos).
  it("PATCH de arquivar uma principal com subcategorias: 2 chamadas e 3 comandos (leitura e lote)", async () => {
    const { householdId, memberId } = await criarLar();
    const medidas: Meter[] = [];
    const app = appDoLar(householdId, memberId, (meter) => medidas.push(meter));
    const saude = achar(await listar(app), "Saúde");

    await callApi(app, "PATCH", `/api/categories/${saude.id}`, { archived: true });

    expect(medidas.at(-1)).toMatchObject({ calls: 2, statements: 3 });
  });
});
