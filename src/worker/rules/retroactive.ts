import { applyRuleRetroactiveSliceStmts } from "../categorization/apply";
import type { Db } from "../db/client";
import { lerRegraPorId, regraParaAplicar } from "./repo";

// Uma fatia do "Aplicar a todas" (TASK-0302): lê a regra (uma ida ao D1) e grava até 2.000 linhas num lote (outra ida).
// Devolve quantas mudaram e quantas faltam. Regra desativada devolve motivo "regra_inativa" (409 na rota).

export type FatiaRetroativa =
  | { ok: true; applied: number; remaining: number }
  | { ok: false; motivo: "nao_encontrada" | "regra_inativa" };

export async function runRetroactiveSlice(
  db: Db,
  householdId: string,
  ruleId: string,
  now: string,
): Promise<FatiaRetroativa> {
  const regra = await lerRegraPorId(db, householdId, ruleId);
  if (regra === null) return { ok: false, motivo: "nao_encontrada" };
  if (regra.disabledAt !== null) return { ok: false, motivo: "regra_inativa" };

  const comandos = applyRuleRetroactiveSliceStmts(db, {
    householdId,
    rule: regraParaAplicar(regra),
    excludeTransactionId: null,
    now,
  });
  if (comandos.length === 0) return { ok: true, applied: 0, remaining: 0 };

  const resultados = await db.$client.batch(comandos);
  const fatia = resultados.slice(0, -1);
  const applied = fatia.reduce((total, resultado) => total + (resultado.meta?.changes ?? 0), 0);
  const contagem = resultados[resultados.length - 1]?.results?.[0] as { restantes: number } | undefined;
  return { ok: true, applied, remaining: contagem?.restantes ?? 0 };
}
