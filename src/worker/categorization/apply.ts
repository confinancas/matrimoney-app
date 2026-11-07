import {
  COUNTERPARTY_KEY_SQL,
  ESTABLISHMENT_KEY_SQL,
  type RuleScope,
  SCOPE_MOVEMENTS,
} from "../../shared/rule-match";
import type { Db } from "../db/client";

// Único arquivo que grava category_id (TASK-0302). Toda escrita de categoria, nome, tipo ou movimento por regra ou
// por escolha do casal sai daqui. As chaves de casamento vêm do servidor (ESTABLISHMENT_KEY_SQL e COUNTERPARTY_KEY_SQL,
// com o alias t). Escrita nunca toca ai_category_id (a sugestão da IA fica como está).

// Regra já pronta para gravar: a categoria aqui é a categoria ativa, ou null (categoria arquivada não grava).
export type RegraParaAplicar = {
  id: string;
  scope: RuleScope;
  matchValue: string;
  setCustomName: string | null;
  setCategoryId: string | null;
  setSpendType: string | null;
  setMovement: string | null;
};

const TIPOS_FORA_DO_CARTAO: ReadonlySet<string> = new Set(["metas", "investimentos"]);
const LIMITE_DA_FATIA = 500;
const FATIAS_POR_REQUISICAO = 4;

const marcas = (quantidade: number): string => Array.from({ length: quantidade }, () => "?").join(", ");

const chaveDoEscopo = (escopo: RuleScope): string =>
  escopo === "estabelecimento" ? ESTABLISHMENT_KEY_SQL : COUNTERPARTY_KEY_SQL;

type Escrita = { sets: string[]; params: unknown[] };

// SET de uma regra, só com o que ela faz. Nome só quando a transação não tem nome próprio. Tipo de gasto nunca
// metas/investimentos numa compra de cartão (quando o cartão é conhecido, nem entra no SET). Movimento grava o
// anterior. A marca de categorização (categorized_*, rule_id) só entra quando grava categoria ou movimento.
function escritaDaRegra(
  regra: RegraParaAplicar,
  agora: string,
  cartaoConhecido: { cardId: string | null } | null,
): Escrita | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  const tipo = regra.setSpendType;
  const tipoBloqueado =
    tipo !== null &&
    cartaoConhecido !== null &&
    cartaoConhecido.cardId !== null &&
    TIPOS_FORA_DO_CARTAO.has(tipo);
  const gravaCategoria = regra.setCategoryId !== null;
  const gravaMovimento = regra.setMovement !== null;
  const marca = gravaCategoria || gravaMovimento;

  if (regra.setCustomName !== null) {
    sets.push("custom_name = CASE WHEN custom_name IS NULL THEN ? ELSE custom_name END");
    params.push(regra.setCustomName);
  }
  if (tipo !== null && !tipoBloqueado) {
    const bloqueio = "card_id IS NOT NULL AND ? IN ('metas', 'investimentos')";
    sets.push(`spend_type = CASE WHEN ${bloqueio} THEN spend_type ELSE ? END`);
    params.push(tipo, tipo);
    sets.push(`spend_type_source = CASE WHEN ${bloqueio} THEN spend_type_source ELSE 'regra' END`);
    params.push(tipo);
  }
  if (gravaMovimento) {
    sets.push(
      "movement_original = CASE WHEN movement = ? THEN movement_original ELSE COALESCE(movement_original, movement) END",
    );
    params.push(regra.setMovement);
    sets.push("movement = ?");
    params.push(regra.setMovement);
    sets.push("movement_locked = 1");
  }
  if (gravaCategoria) {
    sets.push("category_id = ?");
    params.push(regra.setCategoryId);
  }
  if (marca) {
    sets.push("categorized_at = ?", "categorized_by = 'regra'", "rule_id = ?");
    params.push(agora, regra.id);
  }
  if (sets.length === 0) return null;
  return { sets, params };
}

// Escolha manual do casal (PUT) ou gravação de uma regra de "Aplicar a todas" feita pela transação escolhida.
// by = member_id, ou 'regra'. ruleId nulo numa mudança manual sem "Aplicar a todas".
export function setTransactionCategoryStmt(
  db: Db,
  entrada: {
    householdId: string;
    transactionId: string;
    categoryId: string;
    by: string;
    ruleId: string | null;
    now: string;
  },
): D1PreparedStatement {
  return db.$client
    .prepare(
      "UPDATE transactions SET category_id = ?, categorized_at = ?, categorized_by = ?, rule_id = ? WHERE id = ? AND household_id = ?",
    )
    .bind(
      entrada.categoryId,
      entrada.now,
      entrada.by,
      entrada.ruleId,
      entrada.transactionId,
      entrada.householdId,
    );
}

// Importação (passo 3 do afterIngest): a regra gravada numa transação. Nulo quando a regra não tem o que gravar
// (só nome, com categoria arquivada). cardId, quando conhecido, impede metas/investimentos num cartão.
export function applyRuleToTransactionStmt(
  db: Db,
  entrada: {
    householdId: string;
    transactionId: string;
    rule: RegraParaAplicar;
    cardId: string | null;
    now: string;
  },
): D1PreparedStatement | null {
  const escrita = escritaDaRegra(entrada.rule, entrada.now, { cardId: entrada.cardId });
  if (escrita === null) return null;
  return db.$client
    .prepare(`UPDATE transactions AS t SET ${escrita.sets.join(", ")} WHERE t.id = ? AND t.household_id = ?`)
    .bind(...escrita.params, entrada.transactionId, entrada.householdId);
}

// Retroativo (uma fatia): 4 UPDATEs de até 500 linhas e 1 COUNT do que falta, no mesmo lote. Cada UPDATE pega as
// linhas do lar com a chave e o escopo da regra que ainda não têm esta regra (rule_id). "Todas" inclui as escolhidas à
// mão e as ocultas. O EXISTS faz uma regra desativada no meio do caminho parar de escrever. Sem categoria nem
// movimento para gravar, a regra não tem fatia: devolve lista vazia (o chamador trata como nada a fazer).
export function applyRuleRetroactiveSliceStmts(
  db: Db,
  entrada: {
    householdId: string;
    rule: RegraParaAplicar;
    excludeTransactionId: string | null;
    now: string;
  },
): D1PreparedStatement[] {
  const { rule } = entrada;
  const escrita = escritaDaRegra(rule, entrada.now, null);
  if (escrita === null || (rule.setCategoryId === null && rule.setMovement === null)) return [];

  const movimentos = SCOPE_MOVEMENTS[rule.scope];
  const filtro = `t.household_id = ? AND ${chaveDoEscopo(rule.scope)} = ? AND t.movement IN (${marcas(movimentos.length)})
    AND (t.rule_id IS NULL OR t.rule_id <> ?) AND t.id <> ?`;
  const paramsDoFiltro = [
    entrada.householdId,
    rule.matchValue,
    ...movimentos,
    rule.id,
    entrada.excludeTransactionId ?? "",
  ];

  const comandos: D1PreparedStatement[] = [];
  for (let fatia = 0; fatia < FATIAS_POR_REQUISICAO; fatia++) {
    comandos.push(
      db.$client
        .prepare(
          `UPDATE transactions AS u SET ${escrita.sets.join(", ")}
            WHERE u.id IN (SELECT t.id FROM transactions AS t WHERE ${filtro} LIMIT ${LIMITE_DA_FATIA})
            AND EXISTS (SELECT 1 FROM rules AS r WHERE r.id = ? AND r.disabled_at IS NULL)`,
        )
        .bind(...escrita.params, ...paramsDoFiltro, rule.id),
    );
  }
  comandos.push(
    db.$client
      .prepare(`SELECT COUNT(*) AS restantes FROM transactions AS t WHERE ${filtro}`)
      .bind(...paramsDoFiltro),
  );
  return comandos;
}

// Os iguais que esperavam (quando nasce uma regra por "Lembrar" ou por confirmação): as outras transações da chave que
// nenhuma pessoa escolheu seguem a regra. Só com categoria ativa ou com movimento. Devolve os ids que mudaram.
export function applyRuleToPendingStmt(
  db: Db,
  entrada: {
    householdId: string;
    rule: RegraParaAplicar;
    excludeTransactionId: string | null;
    now: string;
  },
): D1PreparedStatement | null {
  const { rule } = entrada;
  if (rule.setCategoryId === null && rule.setMovement === null) return null;
  const escrita = escritaDaRegra(rule, entrada.now, null);
  if (escrita === null) return null;
  const movimentos = SCOPE_MOVEMENTS[rule.scope];
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET ${escrita.sets.join(", ")}
        WHERE t.household_id = ? AND ${chaveDoEscopo(rule.scope)} = ? AND t.movement IN (${marcas(movimentos.length)})
        AND t.removed_at IS NULL AND (t.category_id IS NULL OR t.categorized_by = 'ia') AND t.id <> ?
        RETURNING id, category_id`,
    )
    .bind(
      ...escrita.params,
      entrada.householdId,
      rule.matchValue,
      ...movimentos,
      entrada.excludeTransactionId ?? "",
    );
}
