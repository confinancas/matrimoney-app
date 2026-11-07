import type { Db } from "../db/client";
import { CATEGORY_SEED, seedId } from "./semente";

export { CATEGORY_SEED, seedId, seedRefs } from "./semente";

// Os INSERT OR IGNORE da semente, para entrar num db.batch() de quem já vai gravar.
export function seedStatements(db: Db, householdId: string): D1PreparedStatement[] {
  const d1 = db.$client;
  return CATEGORY_SEED.map((semente) =>
    d1
      .prepare(
        "INSERT OR IGNORE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)",
      )
      .bind(
        seedId(householdId, semente.slug),
        householdId,
        semente.nome,
        semente.cor,
        semente.pai === null ? null : seedId(householdId, semente.pai),
        semente.tipo,
        semente.sort,
      ),
  );
}

// Semente de um lar sem nenhuma linha (arquivadas contam). Um só db.batch(); repetir não duplica.
export async function ensureCategorySeed(db: Db, householdId: string): Promise<void> {
  await db.$client.batch(seedStatements(db, householdId));
}
