import { COUNTERPARTY_KEY_SQL, chaveVazia, type RuleScope } from "../../shared/rule-match";
import type { Db } from "../db/client";
import { applyRuleToTransactionStmt, type RegraParaAplicar } from "./apply";

// Pipeline de regras na importação (TASK-0302). Chamado pelo afterIngest, depois da classificação e do ciclo, só com os
// ids inseridos. No máximo 2 idas ao D1: uma leitura (as linhas e os casamentos, num lote) e uma escrita (as regras).
// Escopo remetente fica de fora nesta task (a TASK-0903 o acrescenta). As TASK-0303, 0902 e 0903 acrescentam passos aqui.

export type ResultadoDoPipeline = {
  // Ids que a regra categorizou nesta chamada.
  categorizedByRule: string[];
  // Ids (dos recebidos) que continuam sem categoria e não viraram pagamento de fatura.
  pending: string[];
};

type LinhaDaImportacao = {
  id: string;
  movement: string;
  card_id: string | null;
  category_id: string | null;
};

type CasamentoDeRegra = {
  transaction_id: string;
  card_id: string | null;
  rule_id: string;
  scope: string;
  match_value: string;
  set_custom_name: string | null;
  set_category_id: string | null;
  set_spend_type: string | null;
  set_movement: string | null;
  categoria_ativa: string | null;
};

// Escopo estabelecimento (compras e saídas de cartão e conta) e destinatário (Pix e TED enviados). Cada transação casa
// no máximo com uma regra: o escopo vem do movimento. Só regra ativa, só transação ainda sem categoria.
const SQL_CASAMENTOS = `SELECT t.id AS transaction_id, t.card_id AS card_id, r.id AS rule_id, r.scope AS scope,
    r.match_value AS match_value, r.set_custom_name AS set_custom_name, r.set_category_id AS set_category_id,
    r.set_spend_type AS set_spend_type, r.set_movement AS set_movement, c.id AS categoria_ativa
  FROM json_each(?) AS j
  JOIN transactions AS t ON t.id = j.value AND t.household_id = ? AND t.category_id IS NULL
    AND t.movement IN ('compra', 'estorno', 'debito', 'boleto')
  JOIN rules AS r ON r.household_id = t.household_id AND r.disabled_at IS NULL
    AND r.scope = 'estabelecimento' AND r.match_value = t.establishment_key
  LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL
  UNION ALL
  SELECT t.id AS transaction_id, t.card_id AS card_id, r.id AS rule_id, r.scope AS scope,
    r.match_value AS match_value, r.set_custom_name AS set_custom_name, r.set_category_id AS set_category_id,
    r.set_spend_type AS set_spend_type, r.set_movement AS set_movement, c.id AS categoria_ativa
  FROM json_each(?) AS j
  JOIN transactions AS t ON t.id = j.value AND t.household_id = ? AND t.category_id IS NULL
    AND t.movement IN ('pix_enviado', 'ted_enviada')
  JOIN rules AS r ON r.household_id = t.household_id AND r.disabled_at IS NULL
    AND r.scope = 'destinatario' AND r.match_value = ${COUNTERPARTY_KEY_SQL}
  LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL`;

const SQL_LINHAS = `SELECT t.id, t.movement, t.card_id, t.category_id FROM json_each(?) AS j
  JOIN transactions AS t ON t.id = j.value WHERE t.household_id = ?`;

const PAGAMENTO_DE_FATURA = "pagamento_fatura";

export async function processNewTransactions(
  db: Db,
  householdId: string,
  transactionIds: readonly string[],
  now: string,
): Promise<ResultadoDoPipeline> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return { categorizedByRule: [], pending: [] };
  const json = JSON.stringify(ids);

  const [linhasLidas, casamentosLidos] = await db.$client.batch([
    db.$client.prepare(SQL_LINHAS).bind(json, householdId),
    db.$client.prepare(SQL_CASAMENTOS).bind(json, householdId, json, householdId),
  ]);
  const linhas = (linhasLidas?.results ?? []) as LinhaDaImportacao[];
  const casamentos = (casamentosLidos?.results ?? []) as CasamentoDeRegra[];

  const escritas: D1PreparedStatement[] = [];
  const categorizadas = new Set<string>();
  const viraramPagamento = new Set<string>();
  for (const casamento of casamentos) {
    const categoriaAtiva = casamento.categoria_ativa !== null && casamento.set_category_id !== null;
    const regra: RegraParaAplicar = {
      id: casamento.rule_id,
      scope: casamento.scope as RuleScope,
      matchValue: casamento.match_value,
      setCustomName: casamento.set_custom_name,
      setCategoryId: categoriaAtiva ? casamento.set_category_id : null,
      setSpendType: casamento.set_spend_type,
      setMovement: casamento.set_movement,
    };
    if (chaveVazia(regra.matchValue)) continue;
    const escrita = applyRuleToTransactionStmt(db, {
      householdId,
      transactionId: casamento.transaction_id,
      rule: regra,
      cardId: casamento.card_id,
      now,
    });
    if (escrita === null) continue;
    escritas.push(escrita);
    if (regra.setCategoryId !== null) categorizadas.add(casamento.transaction_id);
    if (regra.setMovement === PAGAMENTO_DE_FATURA) viraramPagamento.add(casamento.transaction_id);
  }
  if (escritas.length > 0) await db.$client.batch(escritas);

  const porId = new Map(linhas.map((linha) => [linha.id, linha]));
  const pending: string[] = [];
  for (const id of ids) {
    const linha = porId.get(id);
    if (!linha || linha.category_id !== null) continue;
    if (linha.movement === PAGAMENTO_DE_FATURA || viraramPagamento.has(id) || categorizadas.has(id)) continue;
    pending.push(id);
  }
  return { categorizedByRule: [...categorizadas], pending };
}
