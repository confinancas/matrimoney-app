import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { Db } from "../db/client";
import {
  type ContextoClassificacao,
  classify,
  type Decisao,
  diaNumero,
  estaProtegida,
  type LinhaClassificavel,
  somaDias,
} from "./classify-rules";

// D1: até 100 parâmetros por comando. Cada janela de ids usa 45: 1 (household) + 45 + 45 = 91 parâmetros.
const IDS_POR_JANELA = 45;
// Um par tem no máximo 5 dias de distância. A leitura vai 10 dias para cada lado dos ids, para que cada linha
// que se escreve (até 5 dias de um id) tenha a vizinhança de par inteira.
const MARGEM_LEITURA = 10;
const MARGEM_PAR = 5;
// Conciliação: as linhas dos últimos 15 dias são reclassificadas; a leitura cobre 5 dias a mais no futuro.
const DIAS_CONCILIACAO = 15;

const COLUNAS = `id, account_id, card_id, movement, movement_original, movement_locked, hidden, removed_at,
  categorized_by, categorized_at, rule_id, income_kind, income_subtype, local_date, amount_cents, original_description,
  provider_category, provider_operation_type, counterparty_doc_masked`;

const SQL_CPFS =
  "SELECT cpf_masked FROM pluggy_connections WHERE household_id = ? AND cpf_masked IS NOT NULL";
const SQL_BANCOS_COM_CARTAO = `SELECT DISTINCT bi.institution_name AS nome FROM cards c
  JOIN bank_items bi ON bi.id = c.bank_item_id
  JOIN pluggy_connections pc ON pc.id = bi.connection_id
  WHERE pc.household_id = ?`;

// Só movement, a marca de renda e a categoria mudam. movement_original guarda o anterior na primeira mudança.
const SQL_ATUALIZA_LINHA = `UPDATE transactions SET movement = ?,
  movement_original = CASE WHEN movement = ? THEN movement_original ELSE COALESCE(movement_original, movement) END,
  income_kind = ?, income_subtype = ?, categorized_by = ?, categorized_at = ?
  WHERE id = ? AND household_id = ?`;

type Janela = { tipo: "ids"; ids: string[] } | { tipo: "faixa"; de: string; ate: string };

const emGrupos = <T>(itens: T[], tamanho: number): T[][] => {
  const grupos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) grupos.push(itens.slice(i, i + tamanho));
  return grupos;
};

function comandoDaJanela(db: Db, householdId: string, janela: Janela): D1PreparedStatement {
  if (janela.tipo === "faixa") {
    return db.$client
      .prepare(
        `SELECT ${COLUNAS} FROM transactions WHERE household_id = ? AND removed_at IS NULL AND local_date BETWEEN ? AND ?`,
      )
      .bind(householdId, janela.de, janela.ate);
  }
  const marcas = janela.ids.map(() => "?").join(", ");
  return db.$client
    .prepare(
      `SELECT ${COLUNAS} FROM transactions WHERE household_id = ? AND removed_at IS NULL
        AND local_date BETWEEN date((SELECT MIN(local_date) FROM transactions WHERE id IN (${marcas})), ?)
        AND date((SELECT MAX(local_date) FROM transactions WHERE id IN (${marcas})), ?)`,
    )
    .bind(householdId, ...janela.ids, `-${MARGEM_LEITURA} days`, ...janela.ids, `+${MARGEM_LEITURA} days`);
}

type Leitura = {
  pool: LinhaClassificavel[];
  cpfsDoLar: string[];
  bancosComCartao: string[];
};

// Uma ida ao D1 (db.batch): as janelas das linhas, e as conexões e bancos com cartão do lar.
async function lerPool(db: Db, householdId: string, janelas: Janela[]): Promise<Leitura> {
  const comandos = [
    ...janelas.map((janela) => comandoDaJanela(db, householdId, janela)),
    db.$client.prepare(SQL_CPFS).bind(householdId),
    db.$client.prepare(SQL_BANCOS_COM_CARTAO).bind(householdId),
  ];
  const resultados = await db.$client.batch(comandos);

  const porId = new Map<string, LinhaClassificavel>();
  for (const resultado of resultados.slice(0, janelas.length)) {
    for (const linha of resultado.results as unknown as LinhaClassificavel[]) porId.set(linha.id, linha);
  }
  const cpfs = resultados[janelas.length] ?? { results: [] };
  const bancos = resultados[janelas.length + 1] ?? { results: [] };
  return {
    pool: [...porId.values()],
    cpfsDoLar: (cpfs.results as unknown as { cpf_masked: string }[]).map((linha) => linha.cpf_masked),
    bancosComCartao: (bancos.results as unknown as { nome: string }[]).map((linha) => linha.nome),
  };
}

// Valores da UPDATE de uma linha, ou null quando a decisão não muda nada.
function atualizacaoDe(linha: LinhaClassificavel, decisao: Decisao, agora: string): unknown[] | null {
  const mudaMovimento = decisao.movement !== linha.movement;
  const mudaRenda =
    decisao.income_kind !== linha.income_kind || decisao.income_subtype !== linha.income_subtype;
  if (!mudaMovimento && !mudaRenda) return null;

  let categorizadoPor = linha.categorized_by;
  let categorizadoEm = linha.categorized_at;
  if (decisao.income_kind !== linha.income_kind) {
    // Entrada resolvida pela regra leva categorized_by = 'regra'; sem renda marcada, a marca sai junto.
    categorizadoPor = decisao.income_kind === null ? null : "regra";
    categorizadoEm = decisao.income_kind === null ? null : agora;
  }
  return [
    decisao.movement,
    decisao.movement,
    decisao.income_kind,
    decisao.income_subtype,
    categorizadoPor,
    categorizadoEm,
  ];
}

// Classifica o pool e grava, em uma ida ao D1, só as linhas escrevíveis, desprotegidas e que mudaram.
async function classificarEGravar(
  db: Db,
  householdId: string,
  leitura: Leitura,
  hoje: string,
  agora: string,
  escrevivel: (linha: LinhaClassificavel) => boolean,
): Promise<number> {
  const contexto: ContextoClassificacao = {
    hoje,
    cpfsDoLar: leitura.cpfsDoLar,
    bancosComCartao: leitura.bancosComCartao,
  };
  const decisoes = classify(leitura.pool, contexto);
  const porId = new Map(leitura.pool.map((linha) => [linha.id, linha]));

  const comandos: D1PreparedStatement[] = [];
  for (const decisao of decisoes) {
    const linha = porId.get(decisao.id);
    if (!linha || !escrevivel(linha) || estaProtegida(linha)) continue;
    const valores = atualizacaoDe(linha, decisao, agora);
    if (valores === null) continue;
    comandos.push(db.$client.prepare(SQL_ATUALIZA_LINHA).bind(...valores, linha.id, householdId));
  }
  if (comandos.length > 0) await db.$client.batch(comandos);
  return comandos.length;
}

// Passo 1 do afterIngest: classifica as linhas gravadas e atualizadas e as candidatas a par em até 5 dias.
// Devolve quantas linhas mudaram. Até 2 idas ao D1 (leitura e escrita).
export async function classifyMovements(
  db: Db,
  householdId: string,
  ids: string[],
  now: string,
): Promise<number> {
  const idsUnicos = [...new Set(ids)];
  if (idsUnicos.length === 0) return 0;
  const idsNoLote = new Set(idsUnicos);
  const janelas: Janela[] = emGrupos(idsUnicos, IDS_POR_JANELA).map((ids) => ({ tipo: "ids", ids }));
  const leitura = await lerPool(db, householdId, janelas);

  // Só se escreve a menos de 5 dias de uma linha do lote: essa vizinhança está inteira na leitura.
  const diasDoLote = new Set(
    leitura.pool.filter((linha) => idsNoLote.has(linha.id)).map((linha) => diaNumero(linha.local_date)),
  );
  const escrevivel = (linha: LinhaClassificavel): boolean => {
    const dia = diaNumero(linha.local_date);
    for (let delta = -MARGEM_PAR; delta <= MARGEM_PAR; delta++) {
      if (diasDoLote.has(dia + delta)) return true;
    }
    return false;
  };
  return classificarEGravar(db, householdId, leitura, todayInSaoPaulo(now), now, escrevivel);
}

// Conciliação das linhas dos últimos 15 dias do lar (fim da atualização, TASK-0204/0205): é o que faz uma entrada de
// fatura sem par virar pagamento por terceiro depois de 5 dias. Até 2 idas ao D1.
export async function reconcileHousehold(
  db: Db,
  householdId: string,
  today: string,
  now: string,
): Promise<number> {
  const leitura = await lerPool(db, householdId, [
    {
      tipo: "faixa",
      de: somaDias(today, -(DIAS_CONCILIACAO + MARGEM_PAR)),
      ate: somaDias(today, MARGEM_PAR),
    },
  ]);
  const primeiro = diaNumero(today) - DIAS_CONCILIACAO;
  const ultimo = diaNumero(today);
  const escrevivel = (linha: LinhaClassificavel): boolean => {
    const dia = diaNumero(linha.local_date);
    return dia >= primeiro && dia <= ultimo;
  };
  return classificarEGravar(db, householdId, leitura, today, now, escrevivel);
}
