import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { sha256Hex } from "../../../src/shared/access-code";
import type { AppEnv, Env } from "../../../src/worker/env";

// Código de primeiro acesso dos testes, já normalizado (o que o cookie guarda). Digitado: TEST-TEST-TEST.
export const CODIGO_DE_TESTE = "TESTTESTTEST";
export const COOKIE_DE_TESTE = `mm_setup=${CODIGO_DE_TESTE}`;

// Esvazia as tabelas do lar antes de cada teste. Filhos antes dos pais: members referencia households.
export async function limparBanco(db: D1Database): Promise<void> {
  await db.batch([db.prepare("DELETE FROM members"), db.prepare("DELETE FROM households")]);
}

// Um primeiro_acesso com o código de teste. usado: true deixa a instalação em "pronto" (a TASK-0103 faz isso ao criar o lar).
export async function semearPrimeiroAcesso(d1: D1Database, usado: boolean): Promise<void> {
  const agora = new Date().toISOString();
  await d1
    .prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, created_at, used_at) VALUES (?, NULL, 'primeiro_acesso', ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), await sha256Hex(CODIGO_DE_TESTE), agora, usado ? agora : null)
    .run();
}

// Instalação pronta: o portão deixa passar as rotas do app.
export async function semearPronto(d1: D1Database): Promise<void> {
  await semearPrimeiroAcesso(d1, true);
}

// Chama a API pelo app montado com createApp(), com o D1 de teste (sem SELF).
// ambiente troca os bindings (o teste de chave mestra ausente tira MASTER_KEY).
export async function callApi(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  ambiente: Env = env,
): Promise<Response> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), ambiente, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}

// O portão lê o estado da instalação na primeira requisição de cada instância, e depois guarda "pronto".
// Os testes que medem chamadas ao D1 chamam isto antes da medição, para contar só o que a rota faz.
export async function aquecerOPortao(app: Hono<AppEnv>): Promise<void> {
  await callApi(app, "GET", "/api/health");
}
