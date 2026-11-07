import {
  COUNTERPARTY_KEY_SQL,
  chaveVazia,
  ESTABLISHMENT_KEY_SQL,
  mergeRuleSets,
  type RuleScope,
  type RuleSet,
} from "../../shared/rule-match";
import type { RegraParaAplicar } from "../categorization/apply";
import type { Db } from "../db/client";

// Leituras e escritas de regras (TASK-0302). Tudo filtrado pelo lar. As chaves de casamento saem do SQL (t.), nunca do
// cliente. Uma leitura é uma ida ao D1 (db.$client.batch), com os comandos de leitura do contexto.

export type TransacaoDoContexto = {
  id: string;
  movement: string;
  cardId: string | null;
  categoryId: string | null;
  aiCategoryId: string | null;
  customName: string | null;
  spendType: string | null;
  establishmentKey: string | null;
  // Texto da chave do destinatário (nome em maiúsculas, "|", documento). "|" sozinho é chave vazia.
  counterpartyKey: string;
  // Descrição sem espaços nas pontas, e o nome do destinatário: os textos que o seletor mostra.
  descricao: string;
  counterpartyName: string | null;
};

// Regra lida do banco, com a informação de se a categoria dela ainda está ativa (categoria arquivada não grava).
export type RegraLida = RuleSet & {
  id: string;
  scope: RuleScope;
  matchValue: string;
  createdFrom: string;
  createdAt: string;
  disabledAt: string | null;
  categoriaAtiva: boolean;
};

export type ContextoDeCategorizacao = {
  transacao: TransacaoDoContexto | null;
  categoriaAtiva: boolean | null;
  categoriaExiste: boolean;
  regraEstabelecimento: RegraLida | null;
  regraDestinatario: RegraLida | null;
};

type LinhaTransacao = {
  id: string;
  movement: string;
  card_id: string | null;
  category_id: string | null;
  ai_category_id: string | null;
  custom_name: string | null;
  spend_type: string | null;
  establishment_key: string | null;
  contraparte_chave: string;
  descricao: string;
  counterparty_name: string | null;
};

type LinhaRegra = {
  id: string;
  scope: string;
  match_value: string;
  set_custom_name: string | null;
  set_category_id: string | null;
  set_spend_type: string | null;
  set_income_kind: string | null;
  set_income_subtype: string | null;
  set_fixed_income_id: string | null;
  set_movement: string | null;
  created_from: string;
  created_at: string;
  disabled_at: string | null;
  categoria_ativa: number;
};

const SQL_TRANSACAO = `SELECT t.id, t.movement, t.card_id, t.category_id, t.ai_category_id, t.custom_name, t.spend_type,
  t.establishment_key, ${COUNTERPARTY_KEY_SQL} AS contraparte_chave, TRIM(t.original_description) AS descricao,
  t.counterparty_name
  FROM transactions AS t WHERE t.id = ? AND t.household_id = ?`;

const SQL_CATEGORIA = "SELECT id, archived_at FROM categories WHERE id = ? AND household_id = ?";

// A regra ativa do alvo: a chave vem da própria transação (subconsulta), então o cliente não manda chave nenhuma.
const colunasDaRegra = `r.id, r.scope, r.match_value, r.set_custom_name, r.set_category_id, r.set_spend_type,
  r.set_income_kind, r.set_income_subtype, r.set_fixed_income_id, r.set_movement, r.created_from, r.created_at,
  r.disabled_at, (c.id IS NOT NULL) AS categoria_ativa`;

const SQL_REGRA_ATIVA = (chave: string): string => `SELECT ${colunasDaRegra}
  FROM rules AS r LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = r.household_id AND c.archived_at IS NULL
  WHERE r.household_id = ? AND r.scope = ? AND r.disabled_at IS NULL
    AND r.match_value = (SELECT ${chave} FROM transactions AS t WHERE t.id = ? AND t.household_id = ?)`;

const SQL_REGRA_POR_ID = `SELECT ${colunasDaRegra}
  FROM rules AS r LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = r.household_id AND c.archived_at IS NULL
  WHERE r.id = ? AND r.household_id = ?`;

const paraRegra = (linha: LinhaRegra): RegraLida => ({
  id: linha.id,
  scope: linha.scope as RuleScope,
  matchValue: linha.match_value,
  setCustomName: linha.set_custom_name,
  setCategoryId: linha.set_category_id,
  setSpendType: linha.set_spend_type,
  setIncomeKind: linha.set_income_kind,
  setIncomeSubtype: linha.set_income_subtype,
  setFixedIncomeId: linha.set_fixed_income_id,
  setMovement: linha.set_movement,
  createdFrom: linha.created_from,
  createdAt: linha.created_at,
  disabledAt: linha.disabled_at,
  categoriaAtiva: linha.categoria_ativa === 1,
});

const primeira = <T>(resultado: D1Result<unknown> | undefined): T | null =>
  ((resultado?.results ?? [])[0] as T | undefined) ?? null;

// Contexto de uma transação para categorizar: a transação, a categoria pedida (se houver) e as regras ativas dos dois
// alvos possíveis. Uma ida ao D1.
export async function getRuleContextForTransaction(
  db: Db,
  householdId: string,
  transactionId: string,
  categoryId: string | null,
): Promise<ContextoDeCategorizacao> {
  const [transacao, categoria, estabelecimento, destinatario] = await db.$client.batch([
    db.$client.prepare(SQL_TRANSACAO).bind(transactionId, householdId),
    db.$client.prepare(SQL_CATEGORIA).bind(categoryId ?? "", householdId),
    db.$client
      .prepare(SQL_REGRA_ATIVA(ESTABLISHMENT_KEY_SQL))
      .bind(householdId, "estabelecimento", transactionId, householdId),
    db.$client
      .prepare(SQL_REGRA_ATIVA(COUNTERPARTY_KEY_SQL))
      .bind(householdId, "destinatario", transactionId, householdId),
  ]);

  const linha = primeira<LinhaTransacao>(transacao);
  const cat = primeira<{ id: string; archived_at: string | null }>(categoria);
  const regraEstab = primeira<LinhaRegra>(estabelecimento);
  const regraDest = primeira<LinhaRegra>(destinatario);
  return {
    transacao: linha
      ? {
          id: linha.id,
          movement: linha.movement,
          cardId: linha.card_id,
          categoryId: linha.category_id,
          aiCategoryId: linha.ai_category_id,
          customName: linha.custom_name,
          spendType: linha.spend_type,
          establishmentKey: linha.establishment_key,
          counterpartyKey: linha.contraparte_chave,
          descricao: linha.descricao,
          counterpartyName: linha.counterparty_name,
        }
      : null,
    categoriaAtiva: cat ? cat.archived_at === null : null,
    categoriaExiste: cat !== null,
    regraEstabelecimento: regraEstab ? paraRegra(regraEstab) : null,
    regraDestinatario: regraDest ? paraRegra(regraDest) : null,
  };
}

// Uma regra pelo id, do lar, desativada inclusive (o retroativo precisa saber se ela ainda vale).
export async function lerRegraPorId(db: Db, householdId: string, ruleId: string): Promise<RegraLida | null> {
  const resultado = await db.$client.prepare(SQL_REGRA_POR_ID).bind(ruleId, householdId).all<LinhaRegra>();
  const linha = resultado.results[0];
  return linha ? paraRegra(linha) : null;
}

// A regra como o aplicador a usa: a categoria só vai se estiver ativa (categoria arquivada não grava).
export function regraParaAplicar(regra: RegraLida): RegraParaAplicar {
  return {
    id: regra.id,
    scope: regra.scope,
    matchValue: regra.matchValue,
    setCustomName: regra.setCustomName,
    setCategoryId: regra.setCategoryId !== null && regra.categoriaAtiva ? regra.setCategoryId : null,
    setSpendType: regra.setSpendType,
    setMovement: regra.setMovement,
  };
}

// Só os campos que o casal decide (o que a mescla herda e sobrepõe).
export const conjuntoDaRegra = (regra: RegraLida | null): Partial<RuleSet> | null =>
  regra === null
    ? null
    : {
        setCustomName: regra.setCustomName,
        setCategoryId: regra.setCategoryId,
        setSpendType: regra.setSpendType,
        setIncomeKind: regra.setIncomeKind,
        setIncomeSubtype: regra.setIncomeSubtype,
        setFixedIncomeId: regra.setFixedIncomeId,
        setMovement: regra.setMovement,
      };

export type UpsertRegra = {
  householdId: string;
  scope: RuleScope;
  matchValue: string;
  // A ativa do mesmo alvo, se houver (lida antes, no mesmo contexto).
  ativa: RegraLida | null;
  nova: RuleSet;
  createdFrom: "aplicar_todas" | "lembrar" | "confirmacao" | "manual";
  createdBy: string;
  now: string;
};

// Desativa a ativa do mesmo alvo e insere a mesclada, no mesmo lote. A ordem importa: a desativação vem antes da
// inserção, por causa do índice único parcial rules_active_match (uma ativa por alvo).
export function upsertRuleStmts(
  db: Db,
  entrada: UpsertRegra,
): { comandos: D1PreparedStatement[]; id: string; mesclada: RuleSet } {
  if (chaveVazia(entrada.matchValue)) throw new RangeError("Regra sem chave de casamento.");
  const mesclada = mergeRuleSets(conjuntoDaRegra(entrada.ativa), entrada.nova);
  const id = crypto.randomUUID();
  const comandos: D1PreparedStatement[] = [
    db.$client
      .prepare(
        "UPDATE rules SET disabled_at = ? WHERE household_id = ? AND scope = ? AND match_value = ? AND disabled_at IS NULL",
      )
      .bind(entrada.now, entrada.householdId, entrada.scope, entrada.matchValue),
    db.$client
      .prepare(
        `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type,
          set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        id,
        entrada.householdId,
        entrada.scope,
        entrada.matchValue,
        mesclada.setCustomName,
        mesclada.setCategoryId,
        mesclada.setSpendType,
        mesclada.setIncomeKind,
        mesclada.setIncomeSubtype,
        mesclada.setFixedIncomeId,
        mesclada.setMovement,
        entrada.createdFrom,
        entrada.createdBy,
        entrada.now,
      ),
  ];
  return { comandos, id, mesclada };
}

// Desativa uma regra do lar (DELETE). As transações ficam como estão.
export function disableRuleStmt(
  db: Db,
  householdId: string,
  ruleId: string,
  now: string,
): D1PreparedStatement {
  return db.$client
    .prepare("UPDATE rules SET disabled_at = ? WHERE id = ? AND household_id = ? AND disabled_at IS NULL")
    .bind(now, ruleId, householdId);
}
