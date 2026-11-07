import { env } from "cloudflare:test";
import { establishmentKey } from "../../../src/shared/establishment-key";
import { ensureCategorySeed } from "../../../src/worker/categories/seed";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { createHousehold } from "../../../src/worker/household/repository";

// Dados de teste das regras (TASK-0302). Tudo [TEST]; os ids das categorias da semente seguem seed:<lar>:<slug>.

export const AGORA = "2026-11-10T12:00:00.000Z";
export const HOJE = "2026-11-10";

export type Lar = {
  householdId: string;
  memberId: string;
  bankItemId: string;
  accountId: string;
  cardId: string;
};

export const categoriaDoLar = (lar: Pick<Lar, "householdId">, slug: string): string =>
  `seed:${lar.householdId}:${slug}`;

// Um lar com a semente, uma conexão, um banco, uma conta corrente e um cartão.
export async function criarLar(): Promise<Lar> {
  const db = createDb(env.DB, newMeter());
  const { householdId, memberId } = await createHousehold(db, {
    brand: "matrimoney",
    titular: { name: "[TEST] Pessoa A", email: "pessoa-a@example.com" },
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
    ).bind(bankItemId, connectionId, AGORA),
    env.DB.prepare(
      "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
    ).bind(accountId, bankItemId, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '1234', '[TEST] Cartão')",
    ).bind(cardId, bankItemId),
  ]);
  await ensureCategorySeed(createDb(env.DB, newMeter()), householdId);
  return { householdId, memberId, bankItemId, accountId, cardId };
}

// Segundo lar, direto no D1 (o repositório aceita um lar só), com um membro.
export async function criarOutroLar(): Promise<{ householdId: string; memberId: string }> {
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      householdId,
      AGORA,
    ),
    env.DB.prepare(
      "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, '[TEST] Pessoa B', 'titular', ?)",
    ).bind(memberId, householdId, AGORA),
  ]);
  return { householdId, memberId };
}

export type TransacaoSemente = {
  id?: string;
  na?: "conta" | "cartao";
  movement: string;
  amountCents: number;
  descricao: string;
  localDate?: string;
  contraparte?: string | null;
  doc?: string | null;
  categoryId?: string | null;
  aiCategoryId?: string | null;
  categorizedBy?: string | null;
  customName?: string | null;
  spendType?: string | null;
  spendTypeSource?: string | null;
  ruleId?: string | null;
  movementLocked?: number;
  movementOriginal?: string | null;
  incomeKind?: string | null;
  removedAt?: string | null;
};

// Uma transação de teste, com a chave de estabelecimento calculada como a importação calcula.
export async function inserirTransacao(lar: Lar, t: TransacaoSemente): Promise<string> {
  const id = t.id ?? crypto.randomUUID();
  const naConta = (t.na ?? "conta") === "conta";
  await env.DB.prepare(
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, movement_original,
       movement_locked, occurred_at, local_date, amount_cents, original_description, establishment_key, counterparty_name,
       counterparty_doc_masked, category_id, ai_category_id, categorized_by, categorized_at, custom_name, spend_type,
       spend_type_source, rule_id, income_kind, removed_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      lar.householdId,
      `[TEST] ext-${id}`,
      lar.bankItemId,
      naConta ? lar.accountId : null,
      naConta ? null : lar.cardId,
      t.movement,
      t.movementOriginal ?? null,
      t.movementLocked ?? 0,
      `${t.localDate ?? "2026-11-05"}T12:00:00.000Z`,
      t.localDate ?? "2026-11-05",
      t.amountCents,
      t.descricao,
      establishmentKey(t.descricao),
      t.contraparte ?? null,
      t.doc ?? null,
      t.categoryId ?? null,
      t.aiCategoryId ?? null,
      t.categorizedBy ?? null,
      t.categorizedBy ? AGORA : null,
      t.customName ?? null,
      t.spendType ?? null,
      t.spendTypeSource ?? null,
      t.ruleId ?? null,
      t.incomeKind ?? null,
      t.removedAt ?? null,
      AGORA,
    )
    .run();
  return id;
}

// Milhares de compras do mesmo estabelecimento, numa só instrução (recursão), sem parâmetros por linha.
export async function inserirComprasEmLote(lar: Lar, quantidade: number, descricao: string): Promise<void> {
  const chave = establishmentKey(descricao);
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
       amount_cents, original_description, establishment_key, last_seen_at)
     SELECT 'lote-' || i, ?, 'lote-ext-' || i, ?, ?, 'compra', '2026-11-05T12:00:00.000Z', '2026-11-05',
       -1000, ?, ?, ? FROM n`,
  )
    .bind(quantidade, lar.householdId, lar.bankItemId, lar.cardId, descricao, chave, AGORA)
    .run();
}

// Regra direto no banco (para os cenários que não passam pela API).
export async function criarRegra(
  lar: Pick<Lar, "householdId" | "memberId">,
  regra: {
    id?: string;
    scope: "estabelecimento" | "destinatario" | "remetente";
    matchValue: string;
    setCategoryId?: string | null;
    setSpendType?: string | null;
    setCustomName?: string | null;
    setMovement?: string | null;
    createdFrom?: string;
    disabledAt?: string | null;
  },
): Promise<string> {
  const id = regra.id ?? crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type, set_movement,
       created_from, created_by, created_at, disabled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      lar.householdId,
      regra.scope,
      regra.matchValue,
      regra.setCustomName ?? null,
      regra.setCategoryId ?? null,
      regra.setSpendType ?? null,
      regra.setMovement ?? null,
      regra.createdFrom ?? "aplicar_todas",
      lar.memberId,
      AGORA,
      regra.disabledAt ?? null,
    )
    .run();
  return id;
}

export type LinhaDaTabela = {
  id: string;
  movement: string;
  movement_original: string | null;
  movement_locked: number;
  category_id: string | null;
  ai_category_id: string | null;
  categorized_by: string | null;
  categorized_at: string | null;
  custom_name: string | null;
  spend_type: string | null;
  spend_type_source: string | null;
  rule_id: string | null;
  income_kind: string | null;
  card_id: string | null;
  household_id: string;
};

export async function lerTransacao(id: string): Promise<LinhaDaTabela> {
  const linha = await env.DB.prepare(
    `SELECT id, movement, movement_original, movement_locked, category_id, ai_category_id, categorized_by, categorized_at,
       custom_name, spend_type, spend_type_source, rule_id, income_kind, card_id, household_id
     FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<LinhaDaTabela>();
  if (!linha) throw new Error(`transação ${id} não existe`);
  return linha;
}

export const contar = async (sql: string, ...valores: unknown[]): Promise<number> => {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ total: number }>();
  return linha?.total ?? 0;
};
