// Configuração inicial (/api/setup/*, TASK-0102). Abertas no modo configuração; o código de primeiro acesso
// (cookie mm_setup) é exigido nas rotas de chave. Erros pela convenção (apiError).
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { normalizeAccessCode } from "../../shared/access-code";
import type { KeyStatus, SetupStatus } from "../../shared/setup";
import type { AppEnv } from "../env";
import { apiError } from "../http/errors";
import type { ValidacaoDaChave } from "../providers/anthropic";
import { chaveMestraValida } from "../security/crypto";
import {
  conferirNovaChave,
  gravarChaveDaIa,
  gravarFlag,
  lerCorpo,
  lerFuncoes,
  respondeChaveMestraAusente,
  respondeDadosInvalidos,
  respondeErroDaChave,
} from "../setup/chaves";
import { COOKIE_DA_CONFIGURACAO, getSetupState, requireSetupCode } from "../setup/state";

const FORMATO_DO_CODIGO = /^[0-9A-HJKMNP-TV-Z]{12}$/;
// Duas horas: o tempo de uma configuração inicial, sem bloqueio por tentativas (o código tem 60 bits).
const DURACAO_DO_COOKIE_S = 7200;

export function setupRoutes(validar: ValidacaoDaChave): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();

  rotas.get("/status", async (c) => {
    const estado = await getSetupState(c.var.db, getCookie(c, COOKIE_DA_CONFIGURACAO));
    const corpo: SetupStatus = {
      mode: estado.mode,
      unlocked: estado.unlocked,
      masterKeyOk: chaveMestraValida(c.env.MASTER_KEY),
      hasMembers: estado.hasMembers,
    };
    return c.json(corpo, 200);
  });

  rotas.post("/unlock", async (c) => {
    const corpo = await lerCorpo(c);
    const codigo = typeof corpo?.code === "string" ? normalizeAccessCode(corpo.code) : "";
    if (!FORMATO_DO_CODIGO.test(codigo)) {
      return apiError(
        c,
        400,
        "codigo_formato",
        "O código tem 12 letras e números, no formato XXXX-XXXX-XXXX.",
      );
    }

    // O cookie guarda o código normalizado: o banco confere o hash dele contra um primeiro_acesso aberto.
    const estado = await getSetupState(c.var.db, codigo);
    if (!estado.unlocked) {
      return apiError(
        c,
        403,
        "codigo_invalido",
        "Código não confere. Confira no terminal ou rode npm run instalar de novo para gerar outro.",
      );
    }

    setCookie(c, COOKIE_DA_CONFIGURACAO, codigo, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/api",
      maxAge: DURACAO_DO_COOKIE_S,
    });
    return c.json({ mode: estado.mode, unlocked: true }, 200);
  });

  rotas.post("/keys/claude", requireSetupCode(), async (c) => {
    const corpo = await lerCorpo(c);
    if (typeof corpo?.apiKey !== "string") return respondeDadosInvalidos(c);
    const assistente = corpo.assistente ?? false;
    if (typeof assistente !== "boolean") return respondeDadosInvalidos(c);
    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);

    const apiKey = corpo.apiKey;
    try {
      await conferirNovaChave(apiKey, c.env, validar);
    } catch (erro) {
      return respondeErroDaChave(c, erro);
    }

    const claude: KeyStatus = await gravarChaveDaIa(c.var.db, c.env, apiKey);
    await gravarFlag(c.var.db, "assistente", assistente);
    const features = await lerFuncoes(c.var.db);
    return c.json({ claude, features, mode: "cadastro" }, 200);
  });

  rotas.post("/skip-ai", requireSetupCode(), async (c) => {
    await gravarFlag(c.var.db, "sem_ia", true);
    return c.json({ mode: "cadastro" }, 200);
  });

  return rotas;
}
