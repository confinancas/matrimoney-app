import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupStatus } from "../../src/shared/setup";
import { createApp } from "../../src/worker/app";
import { ChaveDaIaError, type ValidacaoDaChave } from "../../src/worker/providers/anthropic";
import { SETUP_OPEN_ROUTES } from "../../src/worker/setup/state";
import { CODIGO_DE_TESTE, COOKIE_DE_TESTE, callApi, semearPrimeiroAcesso, semearPronto } from "./helpers/app";

// Chave falsa do teste: nenhum teste fala com a Anthropic. Os testes procuram este texto em respostas e logs.
const CHAVE = "sk-ant-api03-TEST-valida-0123456789";
const CHAVE_VALIDA_OK: ValidacaoDaChave = async () => undefined;
const recusa =
  (codigo: ChaveDaIaError["code"], status: 400 | 503, mensagem: string): ValidacaoDaChave =>
  async () => {
    throw new ChaveDaIaError(codigo, status, mensagem);
  };
const SEM_MESTRA = { ...env, MASTER_KEY: "" } as typeof env;

const criarApp = (validateClaudeKey: ValidacaoDaChave = CHAVE_VALIDA_OK) => createApp({ validateClaudeKey });

const contagem = async (sql: string): Promise<number> => {
  const linha = await env.DB.prepare(sql).first<{ n: number }>();
  return linha?.n ?? 0;
};

const linhasDeSegredo = () => contagem("SELECT COUNT(*) AS n FROM app_secrets");
const linhasDeFlag = (nome: string) =>
  contagem(`SELECT COUNT(*) AS n FROM feature_flags WHERE name = '${nome}'`);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/setup/status", () => {
  it("sem primeiro acesso usado e sem chave: configuracao, com a chave mestra OK", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "GET", "/api/setup/status");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual<SetupStatus>({
      mode: "configuracao",
      unlocked: false,
      masterKeyOk: true,
      hasMembers: false,
    });
  });

  it("com o cookie do código, unlocked é verdadeiro", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "GET", "/api/setup/status", undefined, {
      cookie: COOKIE_DE_TESTE,
    });

    expect(((await resposta.json()) as SetupStatus).unlocked).toBe(true);
  });

  it("com a chave da IA salva: cadastro", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    await callApi(app, "POST", "/api/setup/keys/claude", { apiKey: CHAVE }, { cookie: COOKIE_DE_TESTE });

    const corpo = (await (await callApi(app, "GET", "/api/setup/status")).json()) as SetupStatus;
    expect(corpo.mode).toBe("cadastro");
  });

  it("com 'continuar sem IA': cadastro, sem chave", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE });

    const corpo = (await (await callApi(app, "GET", "/api/setup/status")).json()) as SetupStatus;
    expect(corpo.mode).toBe("cadastro");
  });

  it("primeiro acesso usado: pronto, e o status continua 200", async () => {
    await semearPronto(env.DB);
    const resposta = await callApi(criarApp(), "GET", "/api/setup/status");

    expect(resposta.status).toBe(200);
    expect((await resposta.json()) as SetupStatus).toMatchObject({ mode: "pronto" });
  });

  it("sem a chave mestra: 200 com masterKeyOk falso, sem erro", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "GET", "/api/setup/status", undefined, {}, SEM_MESTRA);

    expect(resposta.status).toBe(200);
    expect((await resposta.json()) as SetupStatus).toMatchObject({ masterKeyOk: false });
  });
});

describe("POST /api/setup/unlock", () => {
  it("código certo: 200, mode e unlocked, e o cookie mm_setup com os atributos da spec", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/unlock", { code: "TEST-TEST-TEST" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ mode: "configuracao", unlocked: true });
    const cookie = resposta.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`mm_setup=${CODIGO_DE_TESTE}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api");
    expect(cookie).toContain("Max-Age=7200");
  });

  it("aceita o código em minúsculas e sem hífens (é normalizado)", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/unlock", { code: "test-test-test" });

    expect(resposta.status).toBe(200);
  });

  it("código que não confere: 403 codigo_invalido, com a mensagem da spec, e nenhum cookie", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/unlock", { code: "ABCD-EFGH-JKMN" });

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      error: "codigo_invalido",
      message: "Código não confere. Confira no terminal ou rode npm run instalar de novo para gerar outro.",
    });
    expect(resposta.headers.get("set-cookie")).toBeNull();
  });

  it("código mal formatado depois de normalizar: 400 codigo_formato", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    for (const code of ["ABC", "TEST-TEST-TEST-TEST", "UUUU-UUUU-UUUU", ""]) {
      const resposta = await callApi(criarApp(), "POST", "/api/setup/unlock", { code });
      expect(resposta.status, code).toBe(400);
      expect(((await resposta.json()) as { error: string }).error, code).toBe("codigo_formato");
    }
  });

  it("com a instalação pronta: 409 configuracao_concluida", async () => {
    await semearPronto(env.DB);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/unlock", { code: "TEST-TEST-TEST" });

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      error: "configuracao_concluida",
      message: "A configuração já foi concluída.",
    });
  });
});

describe("POST /api/setup/keys/claude", () => {
  it("sem o cookie do código: 403 codigo_necessario, e nada gravado", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const validar = vi.fn(CHAVE_VALIDA_OK);
    const resposta = await callApi(criarApp(validar), "POST", "/api/setup/keys/claude", { apiKey: CHAVE });

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      error: "codigo_necessario",
      message: "Digite o código de primeiro acesso para continuar.",
    });
    expect(validar).not.toHaveBeenCalled();
    expect(await linhasDeSegredo()).toBe(0);
  });

  it("chave válida com o cookie: 200, com o mascarado, a linha cifrada e o modo cadastro", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(
      criarApp(),
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      { cookie: COOKIE_DE_TESTE },
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      claude: { configured: true, masked: "sk-ant-…6789", readable: true },
      features: { ia: true, assistente: false, voz: false },
      mode: "cadastro",
    });
    const linha = await env.DB.prepare(
      "SELECT ciphertext, iv FROM app_secrets WHERE name = 'claude_api_key'",
    ).first<{
      ciphertext: string;
      iv: string;
    }>();
    expect(linha).not.toBeNull();
    expect(linha?.ciphertext).not.toContain(CHAVE);
    expect(linha?.iv.length).toBeGreaterThan(0);
  });

  it("cenário 5: cada erro da Anthropic vira a mensagem do mapa, e nada é gravado", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const casos: [ChaveDaIaError["code"], 400 | 503, string][] = [
      ["chave_invalida", 400, "Chave da Anthropic inválida. Confira se copiou a chave inteira."],
      [
        "sem_credito",
        400,
        "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.",
      ],
      [
        "sem_permissao",
        400,
        "Essa chave não tem permissão para usar a API. Confira a chave no console da Anthropic.",
      ],
      ["modelo_indisponivel", 400, "Essa chave não tem acesso ao Claude Haiku 5.5, usado para categorizar."],
    ];
    for (const [codigo, status, mensagem] of casos) {
      const resposta = await callApi(
        criarApp(recusa(codigo, status, mensagem)),
        "POST",
        "/api/setup/keys/claude",
        { apiKey: CHAVE },
        { cookie: COOKIE_DE_TESTE },
      );
      expect(resposta.status, codigo).toBe(status);
      expect(await resposta.json(), codigo).toEqual({ error: codigo, message: mensagem });
    }
    expect(await linhasDeSegredo()).toBe(0);
  });

  it("cenário 6: Anthropic fora ou sem resposta: 503 anthropic_indisponivel, nada salvo, e dá para tentar de novo", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const mensagem =
      "Não deu para falar com a Anthropic agora. A chave não foi salva: tente de novo em instantes.";
    const resposta = await callApi(
      criarApp(recusa("anthropic_indisponivel", 503, mensagem)),
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      { cookie: COOKIE_DE_TESTE },
    );

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ error: "anthropic_indisponivel", message: mensagem });
    expect(await linhasDeSegredo()).toBe(0);

    const depois = await callApi(
      criarApp(),
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      { cookie: COOKIE_DE_TESTE },
    );
    expect(depois.status).toBe(200);
  });

  it("formato ruim (espaço, vazia, longa): 400 chave_formato sem chamar a validação", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const validar = vi.fn(CHAVE_VALIDA_OK);
    for (const apiKey of ["sk-ant api03", "", "x".repeat(301)]) {
      const resposta = await callApi(
        criarApp(validar),
        "POST",
        "/api/setup/keys/claude",
        { apiKey },
        { cookie: COOKIE_DE_TESTE },
      );
      expect(resposta.status).toBe(400);
      expect(((await resposta.json()) as { error: string }).error).toBe("chave_formato");
    }
    expect(validar).not.toHaveBeenCalled();
    expect(await linhasDeSegredo()).toBe(0);
  });

  it("sem a chave mestra: 500 chave_mestra_ausente, nada chamado e nada gravado", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const validar = vi.fn(CHAVE_VALIDA_OK);
    const resposta = await callApi(
      criarApp(validar),
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      { cookie: COOKIE_DE_TESTE },
      SEM_MESTRA,
    );

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      error: "chave_mestra_ausente",
      message: "A instalação está incompleta: rode npm run instalar de novo no computador.",
    });
    expect(validar).not.toHaveBeenCalled();
    expect(await linhasDeSegredo()).toBe(0);
  });

  it("dois envios com a mesma chave: uma linha só (o upsert não duplica)", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    await callApi(app, "POST", "/api/setup/keys/claude", { apiKey: CHAVE }, { cookie: COOKIE_DE_TESTE });
    await callApi(app, "POST", "/api/setup/keys/claude", { apiKey: CHAVE }, { cookie: COOKIE_DE_TESTE });

    expect(await linhasDeSegredo()).toBe(1);
  });

  it("salvar a chave apaga o 'continuar sem IA'", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE });
    expect(await linhasDeFlag("sem_ia")).toBe(1);

    await callApi(app, "POST", "/api/setup/keys/claude", { apiKey: CHAVE }, { cookie: COOKIE_DE_TESTE });

    expect(await linhasDeFlag("sem_ia")).toBe(0);
  });

  it("cenário 10: a chave não sai em nenhuma resposta, nos erros nem no log", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const espiaLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const espiaAviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const espiaErro = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = criarApp(
      recusa("chave_invalida", 400, "Chave da Anthropic inválida. Confira se copiou a chave inteira."),
    );

    const recusada = await callApi(
      app,
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      {
        cookie: COOKIE_DE_TESTE,
      },
    );
    const aceita = await callApi(
      criarApp(),
      "POST",
      "/api/setup/keys/claude",
      { apiKey: CHAVE },
      {
        cookie: COOKIE_DE_TESTE,
      },
    );
    const status = await callApi(criarApp(), "GET", "/api/setup/status");

    for (const resposta of [recusada, aceita, status]) {
      expect(await resposta.text()).not.toContain(CHAVE);
    }
    const chamadas = [...espiaAviso.mock.calls, ...espiaErro.mock.calls, ...espiaLog.mock.calls];
    expect(JSON.stringify(chamadas)).not.toContain(CHAVE);
  });
});

describe("POST /api/setup/skip-ai", () => {
  it("sem o cookie do código: 403 codigo_necessario, e nada gravado", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/skip-ai");

    expect(resposta.status).toBe(403);
    expect(((await resposta.json()) as { error: string }).error).toBe("codigo_necessario");
    expect(await linhasDeFlag("sem_ia")).toBe(0);
  });

  it("com o cookie: 200 com o modo cadastro, e a flag sem_ia ligada", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/skip-ai", undefined, {
      cookie: COOKIE_DE_TESTE,
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ mode: "cadastro" });
    expect(await linhasDeFlag("sem_ia")).toBe(1);
  });
});

describe("portão da configuração", () => {
  it("configuração: rotas do lar, das funções e das chaves respondem 503 configuracao_pendente", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    const rotas = [
      ["GET", "/api/household", undefined],
      ["GET", "/api/features", undefined],
      ["GET", "/api/settings/keys", undefined],
      ["PUT", "/api/features/assistente", { enabled: true }],
      ["GET", "/api/nao-existe", undefined],
    ] as const;
    for (const [metodo, caminho, corpo] of rotas) {
      const resposta = await callApi(app, metodo, caminho, corpo);
      expect(resposta.status, caminho).toBe(503);
      expect(await resposta.json(), caminho).toEqual({
        error: "configuracao_pendente",
        message: "Configuração pendente.",
      });
    }
  });

  it("cenário 7, em cadastro: as rotas do app seguem fechadas", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE });

    const resposta = await callApi(app, "GET", "/api/features");
    expect(resposta.status).toBe(503);
    expect(((await resposta.json()) as { error: string }).error).toBe("configuracao_pendente");
  });

  it("pronto: /api/setup/* responde 409, e o status continua 200", async () => {
    await semearPronto(env.DB);
    const app = criarApp();

    expect((await callApi(app, "POST", "/api/setup/unlock", { code: "TEST-TEST-TEST" })).status).toBe(409);
    expect(
      (await callApi(app, "POST", "/api/setup/keys/claude", { apiKey: CHAVE }, { cookie: COOKIE_DE_TESTE }))
        .status,
    ).toBe(409);
    expect(
      (await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE })).status,
    ).toBe(409);
    expect((await callApi(app, "GET", "/api/setup/status")).status).toBe(200);
  });

  it("o cache só guarda pronto: a configuração de antes não prende a instalação depois do primeiro acesso", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    expect((await callApi(app, "GET", "/api/features")).status).toBe(503);

    await env.DB.prepare("UPDATE invites SET used_at = ? WHERE kind = 'primeiro_acesso'")
      .bind(new Date().toISOString())
      .run();

    expect((await callApi(app, "GET", "/api/features")).status).toBe(200);
  });

  it("saúde da API segue aberta na configuração (a Abertura usa)", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(criarApp(), "GET", "/api/health");

    expect(resposta.status).toBe(200);
  });
});

// O portão decide pela lista SETUP_OPEN_ROUTES, e por mais nada (a TASK-0108 só acrescenta /api/restore/* nela).
describe("SETUP_OPEN_ROUTES: o portão decide pela lista", () => {
  it("uma rota acrescentada à lista responde fora de pronto; fora da lista, a mesma rota dá 503", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = createApp({
      validateClaudeKey: CHAVE_VALIDA_OK,
      rotasDoApp: (rotas) => {
        rotas.get("/teste-aberto", (c) => c.json({ aberta: true }));
      },
    });
    expect((await callApi(app, "GET", "/api/teste-aberto")).status).toBe(503);

    SETUP_OPEN_ROUTES.push("GET /api/teste-aberto");
    try {
      const resposta = await callApi(app, "GET", "/api/teste-aberto");
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ aberta: true });
    } finally {
      SETUP_OPEN_ROUTES.splice(SETUP_OPEN_ROUTES.indexOf("GET /api/teste-aberto"), 1);
    }
    expect((await callApi(app, "GET", "/api/teste-aberto")).status).toBe(503);
  });

  it("um prefixo acrescentado à lista abre as rotas dele, em qualquer método", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = createApp({
      validateClaudeKey: CHAVE_VALIDA_OK,
      rotasDoApp: (rotas) => {
        rotas.post("/teste-prefixo/itens", (c) => c.json({ ok: true }));
      },
    });
    expect((await callApi(app, "POST", "/api/teste-prefixo/itens")).status).toBe(503);

    SETUP_OPEN_ROUTES.push("/api/teste-prefixo/*");
    try {
      expect((await callApi(app, "POST", "/api/teste-prefixo/itens")).status).toBe(200);
    } finally {
      SETUP_OPEN_ROUTES.splice(SETUP_OPEN_ROUTES.indexOf("/api/teste-prefixo/*"), 1);
    }
  });

  it("a lista de origem vale: a saúde do GET, as rotas de setup e nada mais", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const app = criarApp();
    expect((await callApi(app, "GET", "/api/health")).status).toBe(200);
    expect((await callApi(app, "POST", "/api/health")).status).toBe(503);
    expect((await callApi(app, "GET", "/api/setup/status")).status).toBe(200);
    expect((await callApi(app, "GET", "/api/features")).status).toBe(503);
  });
});
