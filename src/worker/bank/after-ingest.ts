import { processNewTransactions } from "../categorization/pipeline";
import { assignCycleKeys } from "../cycle/calendar";
import type { Db } from "../db/client";
import { classifyMovements } from "./classify";

export type AfterIngestContext = {
  householdId: string;
  bankItemId: string;
  insertedIds: string[];
  updatedIds: string[];
  now: string;
};

// Limite de ids por chamada do pipeline de regras (lotes de até 100, como manda a TASK-0302).
const LOTE_DO_PIPELINE = 100;

// Passos depois de cada gravação. Ordem fixa: cada task acrescenta o seu, nesta ordem, sem trocar a sequência.
//   1. classificação de movimentos (TASK-0207): as inseridas e as atualizadas
//   2. cycle_key (TASK-0801): calendário que cobre as datas, e ciclo dos ids e dos cartões tocados
//   3. processNewTransactions (TASK-0302): regras, só com as inseridas, em lotes de até 100. Entra depois da
//      classificação para que a regra enxergue o movimento já classificado (pagamento de fatura, transferência).
//      As TASK-0303, 0902 e 0903 acrescentam os seus passos depois deste.
export async function afterIngest(db: Db, ctx: AfterIngestContext): Promise<void> {
  const ids = [...ctx.insertedIds, ...ctx.updatedIds];
  await classifyMovements(db, ctx.householdId, ids, ctx.now);
  await assignCycleKeys(db, ctx.householdId, ids);
  for (let inicio = 0; inicio < ctx.insertedIds.length; inicio += LOTE_DO_PIPELINE) {
    const lote = ctx.insertedIds.slice(inicio, inicio + LOTE_DO_PIPELINE);
    await processNewTransactions(db, ctx.householdId, lote, ctx.now);
  }
}
