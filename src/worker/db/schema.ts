import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Lar: um por instalação. Os percentuais são as colunas dos seis tipos de gasto planejados; investimentos é a sobra.
export const households = sqliteTable(
  "households",
  {
    id: text("id").primaryKey(),
    brand: text("brand").notNull(),
    cycleStartDay: integer("cycle_start_day").notNull().default(11),
    pctFixed: integer("pct_fixed").notNull().default(35),
    pctComfort: integer("pct_comfort").notNull().default(10),
    pctEducation: integer("pct_education").notNull().default(5),
    pctExtras: integer("pct_extras").notNull().default(5),
    pctGoals: integer("pct_goals").notNull().default(10),
    pctPleasures: integer("pct_pleasures").notNull().default(10),
    paidPlan: integer("paid_plan", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("households_brand_ck", sql`${t.brand} IN ('matrimoney', 'meumoney')`),
    check("households_cycle_start_day_ck", sql`${t.cycleStartDay} BETWEEN 1 AND 28`),
    check("households_pct_fixed_ck", sql`${t.pctFixed} BETWEEN 0 AND 100`),
    check("households_pct_comfort_ck", sql`${t.pctComfort} BETWEEN 0 AND 100`),
    check("households_pct_education_ck", sql`${t.pctEducation} BETWEEN 0 AND 100`),
    check("households_pct_extras_ck", sql`${t.pctExtras} BETWEEN 0 AND 100`),
    check("households_pct_goals_ck", sql`${t.pctGoals} BETWEEN 0 AND 100`),
    check("households_pct_pleasures_ck", sql`${t.pctPleasures} BETWEEN 0 AND 100`),
    check(
      "households_pct_sum_ck",
      sql`${t.pctFixed} + ${t.pctComfort} + ${t.pctEducation} + ${t.pctExtras} + ${t.pctGoals} + ${t.pctPleasures} <= 100`,
    ),
  ],
);

// Pessoas do lar: no máximo um titular e um cônjuge por lar (o índice único garante).
export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("members_role_ck", sql`${t.role} IN ('titular', 'conjuge')`),
    uniqueIndex("members_household_role_uq").on(t.householdId, t.role),
  ],
);

// Conexões do Meu Pluggy: uma por CPF. As chaves são cifradas (ADR-003) e aceitam nulo: o backup não as leva.
// Um IV para cada cifra (reusar IV quebra o AES-GCM).
export const pluggyConnections = sqliteTable(
  "pluggy_connections",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    label: text("label").notNull(),
    cpfMasked: text("cpf_masked"),
    clientIdEnc: text("client_id_enc"),
    iv: text("iv"),
    clientSecretEnc: text("client_secret_enc"),
    clientSecretIv: text("client_secret_iv"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("pluggy_connections_household_label_uq").on(t.householdId, t.label)],
);

// Um por banco autorizado. O id é o item id do Pluggy. Desconectar mantém o histórico (disconnected_at).
export const bankItems = sqliteTable(
  "bank_items",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => pluggyConnections.id),
    institutionName: text("institution_name").notNull(),
    institutionColor: text("institution_color"),
    consentExpiresAt: text("consent_expires_at"),
    lastSyncAt: text("last_sync_at"),
    status: text("status").notNull().default("ativo"),
    disconnectedAt: text("disconnected_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [check("bank_items_status_ck", sql`${t.status} IN ('ativo', 'instavel', 'acao_necessaria')`)],
);

// Histórico de atualizações. As colunas da fila (slices, cursor, heartbeat) são da TASK-0204.
export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    bankItemId: text("bank_item_id")
      .notNull()
      .references(() => bankItems.id),
    kind: text("kind").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status"),
    newTransactions: integer("new_transactions").notNull().default(0),
    progressPct: integer("progress_pct").notNull().default(0),
  },
  (t) => [
    check("sync_runs_kind_ck", sql`${t.kind} IN ('historico', 'diaria', 'manual')`),
    check(
      "sync_runs_status_ck",
      sql`${t.status} IS NULL OR ${t.status} IN ('ok', 'instavel', 'repetiu', 'erro')`,
    ),
    index("sync_runs_bank_item_started_idx").on(t.bankItemId, t.startedAt),
  ],
);

// Saldo de hoje. Caixinhas vêm de /investments no Pluggy e viram contas.
export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    bankItemId: text("bank_item_id")
      .notNull()
      .references(() => bankItems.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    overdraftUsedCents: integer("overdraft_used_cents").notNull().default(0),
    balanceAt: text("balance_at").notNull(),
  },
  (t) => [
    check("accounts_kind_ck", sql`${t.kind} IN ('corrente', 'caixinha', 'poupanca', 'outra')`),
    index("accounts_bank_item_idx").on(t.bankItemId),
  ],
);

// Cartão de crédito. O Pluggy não informa o melhor dia de compra: best_day fica nulo.
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  bankItemId: text("bank_item_id")
    .notNull()
    .references(() => bankItems.id),
  last4: text("last4").notNull(),
  name: text("name").notNull(),
  limitCents: integer("limit_cents"),
  availableCents: integer("available_cents"),
  bestDay: integer("best_day"),
});

// Faturas. A aberta e as futuras são sintéticas, com id sint:<cardId>:<closes_on>.
export const bills = sqliteTable(
  "bills",
  {
    id: text("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    closesOn: text("closes_on").notNull(),
    dueOn: text("due_on"),
    amountCents: integer("amount_cents"),
    status: text("status").notNull(),
    paidOn: text("paid_on"),
    cycleKey: text("cycle_key"),
  },
  (t) => [
    check("bills_status_ck", sql`${t.status} IN ('aberta', 'fechada', 'paga', 'futura')`),
    index("bills_card_closes_idx").on(t.cardId, t.closesOn),
  ],
);

// Movimentos. Colunas do modelo de dados; as da gravação do Pluggy são as que o mapeamento preenche.
// Colunas sem FK (category_id, rule_id, fixed_*): as tabelas delas nascem em épicos seguintes.
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    externalId: text("external_id").notNull(),
    bankItemId: text("bank_item_id")
      .notNull()
      .references(() => bankItems.id),
    accountId: text("account_id").references(() => accounts.id),
    cardId: text("card_id").references(() => cards.id),
    billId: text("bill_id").references(() => bills.id),
    movement: text("movement").notNull(),
    movementOriginal: text("movement_original"),
    movementLocked: integer("movement_locked").notNull().default(0),
    occurredAt: text("occurred_at").notNull(),
    localDate: text("local_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    originalDescription: text("original_description").notNull(),
    establishmentKey: text("establishment_key"),
    customName: text("custom_name"),
    counterpartyName: text("counterparty_name"),
    counterpartyDocMasked: text("counterparty_doc_masked"),
    counterpartyBank: text("counterparty_bank"),
    pixKeyMasked: text("pix_key_masked"),
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    cycleKey: text("cycle_key"),
    categoryId: text("category_id"),
    spendType: text("spend_type"),
    spendTypeSource: text("spend_type_source"),
    hidden: integer("hidden").notNull().default(0),
    hiddenReason: text("hidden_reason"),
    incomeKind: text("income_kind"),
    incomeSubtype: text("income_subtype"),
    fixedIncomeId: text("fixed_income_id"),
    cardWouldAccept: integer("card_would_accept"),
    aiCategoryId: text("ai_category_id"),
    aiIncomeKind: text("ai_income_kind"),
    aiIncomeSubtype: text("ai_income_subtype"),
    aiFixedIncomeId: text("ai_fixed_income_id"),
    aiConfidence: text("ai_confidence"),
    aiReason: text("ai_reason"),
    categorizedAt: text("categorized_at"),
    categorizedBy: text("categorized_by"),
    ruleId: text("rule_id"),
    fixedBillId: text("fixed_bill_id"),
    isBackfill: integer("is_backfill").notNull().default(0),
    providerCategory: text("provider_category"),
    providerOperationType: text("provider_operation_type"),
    lastSeenAt: text("last_seen_at").notNull(),
    removedAt: text("removed_at"),
  },
  (t) => [
    check(
      "transactions_movement_ck",
      sql`${t.movement} IN ('compra', 'estorno', 'pix_enviado', 'pix_recebido', 'ted_enviada', 'ted_recebida', 'pagamento_fatura', 'transferencia_interna', 'rendimento', 'debito', 'boleto', 'outro')`,
    ),
    check("transactions_account_xor_card_ck", sql`(${t.accountId} IS NULL) <> (${t.cardId} IS NULL)`),
    uniqueIndex("transactions_bank_item_external_uq").on(t.bankItemId, t.externalId),
    index("transactions_household_cycle_idx").on(t.householdId, t.cycleKey),
    index("transactions_household_category_cycle_idx").on(t.householdId, t.categoryId, t.cycleKey),
    index("transactions_household_categorized_idx").on(t.householdId, t.categorizedAt),
    index("transactions_household_local_date_idx").on(t.householdId, t.localDate),
    index("transactions_account_local_date_idx").on(t.accountId, t.localDate),
    index("transactions_card_local_date_idx").on(t.cardId, t.localDate),
    index("transactions_card_bill_idx").on(t.cardId, t.billId),
    index("transactions_bill_idx").on(t.billId),
    index("transactions_household_establishment_idx").on(t.householdId, t.establishmentKey),
    index("transactions_household_fixed_bill_cycle_idx").on(t.householdId, t.fixedBillId, t.cycleKey),
  ],
);

// Calendário do lar: um ciclo por linha (TASK-0801). A chave é o mês em que o ciclo começa. As colunas de número e de
// percentual são da fotografia do ciclo (TASK-0803) e ficam nulas até lá.
export const cycles = sqliteTable(
  "cycles",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    key: text("key").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    prevIncomeCents: integer("prev_income_cents"),
    spendLimitCents: integer("spend_limit_cents"),
    recurringCents: integer("recurring_cents"),
    dailyTargetCents: integer("daily_target_cents"),
    targetComputedOn: text("target_computed_on"),
    balanceClosedAt: text("balance_closed_at"),
    pctFixed: integer("pct_fixed"),
    pctComfort: integer("pct_comfort"),
    pctEducation: integer("pct_education"),
    pctExtras: integer("pct_extras"),
    pctGoals: integer("pct_goals"),
    pctPleasures: integer("pct_pleasures"),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.key] }),
    index("cycles_household_starts_idx").on(t.householdId, t.startsOn),
  ],
);

// Categorias do lar (TASK-0301). parent_id aponta para uma principal do mesmo lar (um nível só, validado na API).
// A semente de um lar sem categorias entra na primeira leitura (ids seed:<householdId>:<slug>).
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => categories.id),
    defaultSpendType: text("default_spend_type"),
    aiHint: text("ai_hint"),
    sort: integer("sort").notNull().default(0),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("categories_household_archived_idx").on(t.householdId, t.archivedAt),
    index("categories_household_parent_idx").on(t.householdId, t.parentId),
  ],
);

// Convites, recuperações e o código de primeiro acesso (TASK-0101). Só o hash do código ou do token fica aqui.
// O primeiro_acesso não tem lar ainda (household_id nulo) e não expira: vale até ser usado ou substituído.
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").references(() => households.id),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    memberId: text("member_id").references(() => members.id),
    inviteeName: text("invitee_name"),
    inviteeEmail: text("invitee_email"),
    createdBy: text("created_by").references(() => members.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    usedAt: text("used_at"),
    cancelledAt: text("cancelled_at"),
  },
  (t) => [
    check("invites_kind_ck", sql`${t.kind} IN ('conjuge', 'recuperacao', 'primeiro_acesso')`),
    uniqueIndex("invites_token_hash_uq").on(t.tokenHash),
    index("invites_kind_used_idx").on(t.kind, t.usedAt),
  ],
);
