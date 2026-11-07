// Regras (TASK-0302): escopo por movimento, chave de casamento e mescla. Puro: nada aqui lê o banco.
// As chaves são calculadas no SQL (o servidor), nunca vêm do cliente. Por isso as expressões abaixo usam o alias t
// da tabela transactions, e o texto delas é o que as consultas do servidor usam.

export type RuleScope = "estabelecimento" | "destinatario" | "remetente" | "conta_destino";

export const RULE_SCOPES: readonly RuleScope[] = [
  "estabelecimento",
  "destinatario",
  "remetente",
  "conta_destino",
];

// Movimentos que cada escopo reconhece. Os outros movimentos não têm regra.
export const SCOPE_MOVEMENTS: Readonly<Record<RuleScope, readonly string[]>> = {
  estabelecimento: ["compra", "estorno", "debito", "boleto"],
  destinatario: ["pix_enviado", "ted_enviada"],
  remetente: ["pix_recebido", "ted_recebida"],
  conta_destino: [],
};

// Escopo de um movimento, ou null quando o movimento não tem regra.
export function ruleScopeForMovement(movement: string): RuleScope | null {
  for (const escopo of RULE_SCOPES) {
    if (SCOPE_MOVEMENTS[escopo].includes(movement)) return escopo;
  }
  return null;
}

// Estabelecimento: a coluna establishment_key, gravada na importação (TASK-0202).
export const ESTABLISHMENT_KEY_SQL = "t.establishment_key";

// Destinatário: nome em maiúsculas e sem espaços nas pontas, "|", e o documento mascarado. Nome vazio e documento
// vazio dão "|", que nunca casa com uma regra (a API recusa a chave vazia).
export const COUNTERPARTY_KEY_SQL =
  "UPPER(TRIM(IFNULL(t.counterparty_name, ''))) || '|' || IFNULL(t.counterparty_doc_masked, '')";

// Chave vazia: sem regra possível (o seletor esconde o switch; POST /api/rules devolve 422).
export const chaveVazia = (chave: string | null | undefined): boolean =>
  chave === null || chave === undefined || chave.trim() === "" || chave.trim() === "|";

// Os campos que uma regra faz quando casa. Nulo = a regra não mexe nisso.
export type RuleSet = {
  setCustomName: string | null;
  setCategoryId: string | null;
  setSpendType: string | null;
  setIncomeKind: string | null;
  setIncomeSubtype: string | null;
  setFixedIncomeId: string | null;
  setMovement: string | null;
};

export const RULE_SET_KEYS = [
  "setCustomName",
  "setCategoryId",
  "setSpendType",
  "setIncomeKind",
  "setIncomeSubtype",
  "setFixedIncomeId",
  "setMovement",
] as const satisfies readonly (keyof RuleSet)[];

// A regra nova herda os set_* não nulos da ativa anterior do mesmo alvo, e os seus (não nulos) sobrepõem os dela.
export function mergeRuleSets(antiga: Partial<RuleSet> | null | undefined, nova: RuleSet): RuleSet {
  const mesclada = {} as RuleSet;
  for (const chave of RULE_SET_KEYS) {
    mesclada[chave] = nova[chave] ?? antiga?.[chave] ?? null;
  }
  return mesclada;
}
