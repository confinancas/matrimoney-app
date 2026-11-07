// Chaves e funções ligadas pela configuração (TASK-0102), usadas pelas rotas de setup e de configurações.

import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { ASSISTANT_AVAILABLE } from "../../shared/features";
import type { FeaturesResponse, KeyStatus } from "../../shared/setup";
import type { Db } from "../db/client";
import { featureFlags } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { apiError } from "../http/errors";
import { ChaveDaIaError, conferirFormatoDaChave, type ValidacaoDaChave } from "../providers/anthropic";
import { maskKey, saveSecret, secretStatus } from "../security/secrets";
import { assistenteAtivo } from "./assistente";

export const NOME_CHAVE_CLAUDE = "claude_api_key";
export const NOME_CHAVE_GOOGLE = "google_tts_key";
const FLAG_SEM_IA = "sem_ia";
const FLAG_ASSISTENTE = "assistente";
const FLAG_VOZ = "voz";

export const MENSAGEM_CHAVE_MESTRA =
  "A instalação está incompleta: rode npm run instalar de novo no computador.";

// Resposta 500 quando a chave mestra não serve para cifrar ou decifrar.
export function respondeChaveMestraAusente(c: Context<AppEnv>) {
  return apiError(c, 500, "chave_mestra_ausente", MENSAGEM_CHAVE_MESTRA);
}

// Antes de gravar: formato (sem chamada) e a chamada à Anthropic. Erro lança ChaveDaIaError e nada é gravado.
export async function conferirNovaChave(apiKey: string, env: Env, validar: ValidacaoDaChave): Promise<void> {
  conferirFormatoDaChave(apiKey);
  await validar(apiKey, env);
}

// Cifra e grava a chave da IA. Salvar uma chave apaga o "continuar sem IA".
export async function gravarChaveDaIa(db: Db, env: Env, apiKey: string): Promise<KeyStatus> {
  await saveSecret(db, env, NOME_CHAVE_CLAUDE, apiKey);
  await db.delete(featureFlags).where(eq(featureFlags.name, FLAG_SEM_IA));
  return { configured: true, masked: maskKey(apiKey), readable: true };
}

export async function gravarFlag(db: Db, nome: string, ligada: boolean): Promise<void> {
  const enabled = ligada ? 1 : 0;
  await db
    .insert(featureFlags)
    .values({ name: nome, enabled })
    .onConflictDoUpdate({ target: featureFlags.name, set: { enabled } });
}

type LinhaDasFuncoes = {
  ia: number;
  voz_chave: number;
  assistente_flag: number | null;
  voz_flag: number | null;
};

// ia: existe a chave da IA. assistente: disponível no código, ligado e com a chave. voz: a chave do Google existe
// e a função não está desligada (a TASK-0601 grava a chave; nesta task, sempre false).
export async function lerFuncoes(db: Db): Promise<FeaturesResponse> {
  const [linha] = await db.all<LinhaDasFuncoes>(sql`SELECT
    (SELECT COUNT(*) FROM app_secrets WHERE name = ${NOME_CHAVE_CLAUDE}) AS ia,
    (SELECT COUNT(*) FROM app_secrets WHERE name = ${NOME_CHAVE_GOOGLE}) AS voz_chave,
    (SELECT enabled FROM feature_flags WHERE name = ${FLAG_ASSISTENTE}) AS assistente_flag,
    (SELECT enabled FROM feature_flags WHERE name = ${FLAG_VOZ}) AS voz_flag`);

  const ia = linha.ia > 0;
  return {
    ia,
    assistente: assistenteAtivo(ASSISTANT_AVAILABLE, ia, linha.assistente_flag === 1),
    voz: linha.voz_chave > 0 && linha.voz_flag !== 0,
  };
}

export async function statusDaChaveDaIa(db: Db, env: Env): Promise<KeyStatus> {
  return secretStatus(db, env, NOME_CHAVE_CLAUDE);
}

export function assistenteIndisponivel(c: Context<AppEnv>) {
  return apiError(c, 409, "assistente_indisponivel", "O assistente não está disponível nesta instalação.");
}

// Corpo JSON como objeto; qualquer outra coisa (texto cru, lista, JSON inválido) vira null.
export async function lerCorpo(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const corpo: unknown = await c.req.json();
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
    return corpo as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const respondeDadosInvalidos = (c: Context<AppEnv>) =>
  apiError(c, 400, "dados_invalidos", "Dados inválidos.");

// O erro da validação vira resposta pela convenção; qualquer outro erro sobe para o tratador global (500).
export function respondeErroDaChave(c: Context<AppEnv>, erro: unknown) {
  if (erro instanceof ChaveDaIaError) return apiError(c, erro.status, erro.code, erro.message);
  throw erro;
}
