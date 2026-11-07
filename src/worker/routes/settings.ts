// Funções e chaves depois da configuração (TASK-0102): GET /api/features, /api/settings/keys (sem o valor),
// a troca da chave da IA e o liga/desliga do assistente. Os dois membros veem e mudam o mesmo.
// A sessão (TASK-0104) entra antes destas rotas; até lá, o portão da configuração é a única barreira.
import { Hono } from "hono";
import { ASSISTANT_AVAILABLE } from "../../shared/features";
import type { KeysResponse } from "../../shared/setup";
import type { AppEnv } from "../env";
import type { ValidacaoDaChave } from "../providers/anthropic";
import { chaveMestraValida } from "../security/crypto";
import { secretStatus } from "../security/secrets";
import { podeLigarAssistente } from "../setup/assistente";
import {
  assistenteIndisponivel,
  conferirNovaChave,
  gravarChaveDaIa,
  gravarFlag,
  lerCorpo,
  lerFuncoes,
  NOME_CHAVE_GOOGLE,
  respondeChaveMestraAusente,
  respondeDadosInvalidos,
  respondeErroDaChave,
  statusDaChaveDaIa,
} from "../setup/chaves";

export function settingsRoutes(validar: ValidacaoDaChave): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();

  rotas.get("/features", async (c) => {
    const funcoes = await lerFuncoes(c.var.db);
    return c.json(funcoes, 200);
  });

  rotas.get("/settings/keys", async (c) => {
    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);
    const corpo: KeysResponse = {
      claude: await statusDaChaveDaIa(c.var.db, c.env),
      google: await secretStatus(c.var.db, c.env, NOME_CHAVE_GOOGLE),
    };
    return c.json(corpo, 200);
  });

  rotas.put("/settings/keys/claude", async (c) => {
    const corpo = await lerCorpo(c);
    if (typeof corpo?.apiKey !== "string") return respondeDadosInvalidos(c);
    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);

    const apiKey = corpo.apiKey;
    try {
      await conferirNovaChave(apiKey, c.env, validar);
    } catch (erro) {
      return respondeErroDaChave(c, erro);
    }

    const claude = await gravarChaveDaIa(c.var.db, c.env, apiKey);
    return c.json({ claude }, 200);
  });

  rotas.put("/features/assistente", async (c) => {
    const corpo = await lerCorpo(c);
    if (typeof corpo?.enabled !== "boolean") return respondeDadosInvalidos(c);

    const funcoes = await lerFuncoes(c.var.db);
    if (!podeLigarAssistente(ASSISTANT_AVAILABLE, funcoes.ia)) return assistenteIndisponivel(c);

    await gravarFlag(c.var.db, "assistente", corpo.enabled);
    return c.json({ assistente: corpo.enabled, voz: funcoes.voz }, 200);
  });

  return rotas;
}
