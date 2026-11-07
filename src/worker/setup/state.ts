// Modo da instalação (TASK-0102): configuracao, cadastro ou pronto. O portão fecha tudo fora de pronto,
// exceto as rotas de configuração. O cache do módulo guarda só "pronto", que é estado final.

import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { sha256Hex } from "../../shared/access-code";
import type { SetupMode } from "../../shared/setup";
import type { Db } from "../db/client";
import type { AppEnv } from "../env";
import { apiError } from "../http/errors";

export const COOKIE_DA_CONFIGURACAO = "mm_setup";

// Rotas que respondem fora de pronto: é a única lista que o portão consulta para isso.
// Entrada "MÉTODO /caminho" (exata) ou "/prefixo/*" (qualquer método). A TASK-0108 acrescenta "/api/restore/*" aqui.
export const SETUP_OPEN_ROUTES: string[] = ["GET /api/health", "/api/setup/*"];

export type EstadoDaConfiguracao = {
  mode: SetupMode;
  unlocked: boolean;
  hasKey: boolean;
  skippedAi: boolean;
  hasMembers: boolean;
};

type LinhaDoEstado = {
  has_key: number;
  done: number;
  unlocked: number;
  members: number;
  skipped_ai: number;
};

// Uma consulta só. O cookie é o código normalizado; o banco guarda o hash dele.
export async function getSetupState(
  db: Db,
  codigoDoCookie: string | undefined,
): Promise<EstadoDaConfiguracao> {
  const hash = await sha256Hex(codigoDoCookie ?? "");
  const [linha] = await db.all<LinhaDoEstado>(sql`SELECT
    (SELECT COUNT(*) FROM app_secrets WHERE name = 'claude_api_key') AS has_key,
    (SELECT COUNT(*) FROM invites WHERE kind = 'primeiro_acesso' AND used_at IS NOT NULL) AS done,
    (SELECT COUNT(*) FROM invites WHERE kind = 'primeiro_acesso' AND used_at IS NULL AND cancelled_at IS NULL AND token_hash = ${hash}) AS unlocked,
    (SELECT COUNT(*) FROM members) AS members,
    (SELECT COUNT(*) FROM feature_flags WHERE name = 'sem_ia' AND enabled = 1) AS skipped_ai`);

  const feito = linha.done > 0;
  const temChaveOuSemIa = linha.has_key > 0 || linha.skipped_ai > 0;
  return {
    mode: feito ? "pronto" : temChaveOuSemIa ? "cadastro" : "configuracao",
    unlocked: linha.unlocked > 0,
    hasKey: linha.has_key > 0,
    skippedAi: linha.skipped_ai > 0,
    hasMembers: linha.members > 0,
  };
}

// O cache só guarda "pronto". Outro modo sempre consulta o banco.
let prontoNoCache = false;

// Só os testes: a próxima requisição consulta o banco de novo.
export function resetSetupCacheForTests(): void {
  prontoNoCache = false;
}

// Decide pela lista SETUP_OPEN_ROUTES, e por mais nada.
export function rotaAbertaNaConfiguracao(metodo: string, caminho: string): boolean {
  return SETUP_OPEN_ROUTES.some((entrada) => {
    if (entrada.endsWith("/*")) return caminho.startsWith(entrada.slice(0, -1));
    const [metodoDaEntrada, caminhoDaEntrada] = entrada.split(" ");
    return metodo === metodoDaEntrada && caminho === caminhoDaEntrada;
  });
}

// Em pronto: /api/setup/* responde 409, salvo GET /api/setup/status. Fora de pronto: só as rotas abertas.
export function setupGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const metodo = c.req.method;
    const caminho = c.req.path;

    let pronto = prontoNoCache;
    if (!pronto) {
      const estado = await getSetupState(c.var.db, getCookie(c, COOKIE_DA_CONFIGURACAO));
      pronto = estado.mode === "pronto";
      if (pronto) prontoNoCache = true;
    }

    if (pronto) {
      const ehStatus = metodo === "GET" && caminho === "/api/setup/status";
      if (caminho.startsWith("/api/setup/") && !ehStatus) {
        return apiError(c, 409, "configuracao_concluida", "A configuração já foi concluída.");
      }
      return next();
    }

    if (rotaAbertaNaConfiguracao(metodo, caminho)) return next();
    return apiError(c, 503, "configuracao_pendente", "Configuração pendente.");
  };
}

// As rotas de chave exigem o código de primeiro acesso no cookie (sha256 do cookie contra um primeiro_acesso aberto).
export function requireSetupCode(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const estado = await getSetupState(c.var.db, getCookie(c, COOKIE_DA_CONFIGURACAO));
    if (!estado.unlocked) {
      return apiError(c, 403, "codigo_necessario", "Digite o código de primeiro acesso para continuar.");
    }
    await next();
  };
}
