import { normalizeStatementText } from "../../shared/statement-text";
import type { Movement } from "./map";

// Funções puras da classificação (TASK-0207). Sem banco: a classify.ts lê e grava.
// Regras sobre o movimento de origem (movement_original, ou movement se nunca mudou): assim a classificação é
// função do que o banco mandou e das linhas do lar, e rodar de novo dá o mesmo resultado.

// Expressões sobre o texto normalizado (maiúsculas, sem acento).
export const CARD_BILL_PAYMENT_RE =
  /\b(FATURA|FAT)\b.{0,12}\b(CARTAO|CARTOES|CREDITO)\b|\bPAG(TO|AMENTO)?\b.{0,6}\bCARTAO\b/;
export const ESTORNO_RE = /\b(ESTORNO|ESTORNADO|DEVOLUCAO|DEVOLVIDO|PIX DEVOLVIDO)\b/;
export const RENDIMENTO_RE = /\b(RENDIMENTO|RENDIMENTOS|REMUNERACAO|JUROS S\/? ?SALDO)\b/;
export const RESGATE_RE = /\b(RESGATE|RESG)\b/;

// Movimentos de origem que cada regra aceita.
const SAIDA_R1: ReadonlySet<string> = new Set(["boleto", "pix_enviado", "ted_enviada", "debito", "outro"]);
const SAIDA_R3: ReadonlySet<string> = new Set(["pix_enviado", "ted_enviada", "outro"]);
const ENTRADA_R3: ReadonlySet<string> = new Set(["pix_recebido", "ted_recebida", "outro"]);
const ENTRADA_R3B: ReadonlySet<string> = new Set(["pix_recebido", "ted_recebida"]);
const ENTRADA_R4: ReadonlySet<string> = new Set(["pix_recebido", "ted_recebida", "outro"]);
const ENTRADA_R5: ReadonlySet<string> = new Set(["pix_recebido", "ted_recebida", "outro", "rendimento"]);
const ENTRADA_R6: ReadonlySet<string> = new Set(["pix_recebido", "ted_recebida", "outro"]);
const CATEGORIAS_RESGATE: ReadonlySet<string> = new Set([
  "Automatic investment",
  "Fixed income",
  "Mutual funds",
  "Variable income",
  "Pension",
]);

// Só o que a classificação lê de cada linha. Os nomes são os das colunas da tabela transactions.
export type LinhaClassificavel = {
  id: string;
  account_id: string | null;
  card_id: string | null;
  movement: Movement;
  movement_original: Movement | null;
  movement_locked: number;
  hidden: number;
  removed_at: string | null;
  categorized_by: string | null;
  categorized_at: string | null;
  rule_id: string | null;
  income_kind: string | null;
  income_subtype: string | null;
  local_date: string;
  amount_cents: number;
  original_description: string;
  provider_category: string | null;
  provider_operation_type: string | null;
  counterparty_doc_masked: string | null;
};

export type ContextoClassificacao = {
  // Dia local de São Paulo (AAAA-MM-DD) em que a classificação roda.
  hoje: string;
  // cpf_masked das conexões do lar.
  cpfsDoLar: readonly string[];
  // Nomes dos bancos (institution_name) que têm cartão no lar.
  bancosComCartao: readonly string[];
};

export type Regra =
  | "R1"
  | "R2-par"
  | "R2-terceiro"
  | "R2-recente"
  | "R3"
  | "R3b"
  | "R4"
  | "R5"
  | "R6"
  | "sem-regra"
  | "marca-alheia"
  | "protegida";

export type Decisao = {
  id: string;
  movement: Movement;
  income_kind: string | null;
  income_subtype: string | null;
  regra: Regra;
};

type Desejado = Omit<Decisao, "id">;

const escapar = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Nome de banco aparece no texto como palavra inteira.
function contemNome(texto: string, nome: string): boolean {
  const normalizado = normalizeStatementText(nome);
  return normalizado.length > 0 && new RegExp(`\\b${escapar(normalizado)}\\b`).test(texto);
}

const textoDe = (linha: LinhaClassificavel): string => normalizeStatementText(linha.original_description);

// Movimento de origem: o que o banco deu antes de qualquer classificação.
const origemDe = (linha: LinhaClassificavel): Movement => linha.movement_original ?? linha.movement;

const eSaidaBanco = (linha: LinhaClassificavel): boolean =>
  linha.account_id !== null && linha.amount_cents < 0;
const eEntradaBanco = (linha: LinhaClassificavel): boolean =>
  linha.account_id !== null && linha.amount_cents > 0;

// Pagamento de fatura do cartão: a entrada no cartão que o Pluggy marca como pagamento.
export function isCardPayment(linha: LinhaClassificavel): boolean {
  return (
    linha.card_id !== null &&
    linha.amount_cents > 0 &&
    (linha.provider_operation_type === "PAGAMENTO_FATURA" ||
      linha.provider_category === "Credit card payment")
  );
}

// R1: saída da conta do lar que é pagamento de fatura (pela categoria, pelo texto, ou "FATURA" com um banco do lar).
export function isBankBillPayment(
  linha: LinhaClassificavel,
  ctx: Pick<ContextoClassificacao, "bancosComCartao">,
): boolean {
  if (!eSaidaBanco(linha) || !SAIDA_R1.has(origemDe(linha))) return false;
  if (linha.provider_category === "Credit card payment") return true;
  const texto = textoDe(linha);
  if (CARD_BILL_PAYMENT_RE.test(texto)) return true;
  return /\bFATURA\b/.test(texto) && ctx.bancosComCartao.some((banco) => contemNome(texto, banco));
}

// Número do dia (dias desde 1970-01-01), para contar distância em dias sem fuso.
export function diaNumero(dataLocal: string): number {
  const [ano, mes, dia] = dataLocal.split("-").map(Number);
  return Math.round(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1) / 86_400_000);
}

export function somaDias(dataLocal: string, dias: number): string {
  return new Date((diaNumero(dataLocal) + dias) * 86_400_000).toISOString().slice(0, 10);
}

type Pareavel = Pick<LinhaClassificavel, "id" | "local_date" | "amount_cents">;

const ordemDePar = (a: Pareavel, b: Pareavel): number => {
  if (a.local_date !== b.local_date) return a.local_date < b.local_date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

// Pareamento guloso e determinístico: candidatos por (local_date, id); cada um pega o par de mesmo valor absoluto
// com a menor distância em dias (empate: o de menor id); cada linha entra em no máximo um par.
function parearGuloso<T extends Pareavel>(
  candidatos: readonly T[],
  podePar: (a: T, b: T) => boolean,
  maxDias: number,
): Array<[T, T]> {
  const porValor = new Map<number, T[]>();
  for (const candidato of candidatos) {
    const valor = Math.abs(candidato.amount_cents);
    const grupo = porValor.get(valor);
    if (grupo) grupo.push(candidato);
    else porValor.set(valor, [candidato]);
  }

  const pares: Array<[T, T]> = [];
  for (const grupo of porValor.values()) {
    grupo.sort(ordemDePar);
    const usados = new Set<string>();
    for (const a of grupo) {
      if (usados.has(a.id)) continue;
      let melhor: T | null = null;
      let melhorDistancia = Number.POSITIVE_INFINITY;
      for (const b of grupo) {
        if (b === a || usados.has(b.id)) continue;
        const distancia = Math.abs(diaNumero(a.local_date) - diaNumero(b.local_date));
        if (distancia > maxDias || !podePar(a, b)) continue;
        if (
          distancia < melhorDistancia ||
          (distancia === melhorDistancia && melhor !== null && b.id < melhor.id)
        ) {
          melhor = b;
          melhorDistancia = distancia;
        }
      }
      if (melhor !== null) {
        usados.add(a.id);
        usados.add(melhor.id);
        pares.push([a, melhor]);
      }
    }
  }
  return pares;
}

// R2: entrada do cartão marcada como pagamento com a saída de mesmo valor de uma conta do lar, até 5 dias.
export function pairBillPayments(
  cartoes: readonly LinhaClassificavel[],
  saidas: readonly LinhaClassificavel[],
): Array<{ cartao: string; banco: string }> {
  const ehCartao = (linha: LinhaClassificavel): boolean => linha.card_id !== null;
  const candidatos = [...cartoes, ...saidas];
  return parearGuloso(candidatos, (a, b) => ehCartao(a) !== ehCartao(b), 5).map(([a, b]) =>
    ehCartao(a) ? { cartao: a.id, banco: b.id } : { cartao: b.id, banco: a.id },
  );
}

// R3: prova de que é a mesma pessoa: categoria "Same person transfer" de um lado, ou documento de um lado igual
// ao CPF mascarado de uma conexão do lar.
function temProva(linha: LinhaClassificavel, cpfs: ReadonlySet<string>): boolean {
  if ((linha.provider_category ?? "").startsWith("Same person transfer")) return true;
  return linha.counterparty_doc_masked !== null && cpfs.has(linha.counterparty_doc_masked);
}

// R3: saída numa conta do lar e entrada noutra conta do lar, mesmo valor, até 2 dias, com prova.
export function pairTransfers(
  saidas: readonly LinhaClassificavel[],
  entradas: readonly LinhaClassificavel[],
  ctx: Pick<ContextoClassificacao, "cpfsDoLar">,
): Array<{ saida: string; entrada: string }> {
  const cpfs = new Set(ctx.cpfsDoLar);
  const candidatos = [...saidas, ...entradas];
  return parearGuloso(
    candidatos,
    (a, b) =>
      a.account_id !== b.account_id &&
      a.amount_cents < 0 !== b.amount_cents < 0 &&
      (temProva(a, cpfs) || temProva(b, cpfs)),
    2,
  ).map(([a, b]) => (a.amount_cents < 0 ? { saida: a.id, entrada: b.id } : { saida: b.id, entrada: a.id }));
}

// Linhas que a classificação nunca muda: escolha de uma pessoa (oculta, travada, categorizada por membro).
export function estaProtegida(linha: LinhaClassificavel): boolean {
  return (
    linha.hidden === 1 ||
    linha.movement_locked === 1 ||
    (linha.categorized_by !== null && linha.categorized_by !== "regra" && linha.categorized_by !== "ia")
  );
}

// Marca que a própria classificação põe no income_kind: transferência, ou rendimento como variável.
const eMarcaPropria = (linha: LinhaClassificavel): boolean =>
  linha.income_kind === "transferencia" ||
  (linha.income_kind === "variavel" && linha.income_subtype === "rendimento");

// Procedência da marca (TASK-0302, correção da TASK-0207): a classificação grava categorized_by = 'regra' com rule_id
// nulo. Regra do casal grava rule_id; a IA grava 'ia'; o membro grava o id dele. Só a marca de procedência própria
// pode ser desfeita; a da IA e a do casal nunca são.
export const minhaMarca = (linha: LinhaClassificavel): boolean =>
  linha.categorized_by === "regra" && linha.rule_id === null;

// Linha que a classificação pode reescrever sem desfazer escolha de ninguém: sem marca, ou com a marca própria.
export const ehDaClassificacao = (linha: LinhaClassificavel): boolean =>
  linha.categorized_by === null || minhaMarca(linha);

const mantem = (linha: LinhaClassificavel): Pick<Desejado, "income_kind" | "income_subtype"> => ({
  income_kind: linha.income_kind,
  income_subtype: linha.income_subtype,
});

// Tira só a marca da própria classificação; a renda que outro caminho marcou (IA, regra do casal) fica como está.
const semMarcaPropria = (linha: LinhaClassificavel): Pick<Desejado, "income_kind" | "income_subtype"> =>
  minhaMarca(linha) && eMarcaPropria(linha) ? { income_kind: null, income_subtype: null } : mantem(linha);

const transferencia = { income_kind: "transferencia", income_subtype: null };

const ehDocDoLar = (linha: LinhaClassificavel, cpfs: ReadonlySet<string>): boolean =>
  linha.counterparty_doc_masked !== null && cpfs.has(linha.counterparty_doc_masked);

// Aplica as regras R1 a R6 na ordem; cada linha resolvida por uma regra sai das seguintes.
// Linhas que a classificação nunca muda (estaProtegida) ficam como estão, mas continuam contando como par.
// Linhas que nenhuma regra reivindica voltam ao movimento de origem; a marca própria sai junto.
export function classify(linhas: readonly LinhaClassificavel[], ctx: ContextoClassificacao): Decisao[] {
  const hojeNumero = diaNumero(ctx.hoje);
  const cpfs = new Set(ctx.cpfsDoLar);
  const vivas = linhas.filter((linha) => linha.removed_at === null);
  const resolvidas = new Map<string, Desejado>();
  const reivindica = (linha: LinhaClassificavel, desejado: Desejado): void => {
    if (!resolvidas.has(linha.id)) resolvidas.set(linha.id, desejado);
  };

  // R1: pagamento na conta.
  for (const linha of vivas) {
    if (isBankBillPayment(linha, ctx)) {
      reivindica(linha, { movement: "pagamento_fatura", ...mantem(linha), regra: "R1" });
    }
  }

  // R2: pagamento no cartão, pareado com saída de conta do lar, ou pagamento por terceiro.
  const cartoes = vivas.filter(isCardPayment);
  const saidasParaPar = vivas.filter((linha) => eSaidaBanco(linha) && SAIDA_R1.has(origemDe(linha)));
  const pareadas = new Set<string>();
  const porId = new Map(vivas.map((linha) => [linha.id, linha]));
  // A volta atrás do R2 (terceiro → par, par → terceiro) só alcança a linha de cartão da própria classificação;
  // a marca da IA ou do casal fica. O par ainda conta como prova para a saída da conta.
  for (const { cartao, banco } of pairBillPayments(cartoes, saidasParaPar)) {
    pareadas.add(cartao);
    pareadas.add(banco);
    const linhaCartao = porId.get(cartao);
    if (linhaCartao && ehDaClassificacao(linhaCartao)) {
      resolvidas.set(cartao, { movement: "pagamento_fatura", ...transferencia, regra: "R2-par" });
    }
    const saida = porId.get(banco);
    if (saida) reivindica(saida, { movement: "pagamento_fatura", ...mantem(saida), regra: "R2-par" });
  }
  for (const cartao of cartoes) {
    if (pareadas.has(cartao.id) || !ehDaClassificacao(cartao)) continue;
    const terceiro = diaNumero(cartao.local_date) <= hojeNumero - 5;
    resolvidas.set(cartao.id, {
      movement: terceiro ? "pix_recebido" : "pagamento_fatura",
      ...semMarcaPropria(cartao),
      regra: terceiro ? "R2-terceiro" : "R2-recente",
    });
  }

  // R3: transferência entre as contas do lar, com prova; R3b: entrada do próprio CPF.
  const saidasR3 = vivas.filter(
    (linha) => eSaidaBanco(linha) && SAIDA_R3.has(origemDe(linha)) && !resolvidas.has(linha.id),
  );
  const entradasR3 = vivas.filter(
    (linha) => eEntradaBanco(linha) && ENTRADA_R3.has(origemDe(linha)) && !resolvidas.has(linha.id),
  );
  for (const par of pairTransfers(saidasR3, entradasR3, ctx)) {
    const saida = porId.get(par.saida);
    const entrada = porId.get(par.entrada);
    if (saida) resolvidas.set(saida.id, { movement: "transferencia_interna", ...mantem(saida), regra: "R3" });
    if (entrada) {
      resolvidas.set(entrada.id, { movement: "transferencia_interna", ...transferencia, regra: "R3" });
    }
  }
  for (const linha of vivas) {
    if (
      eEntradaBanco(linha) &&
      ENTRADA_R3B.has(origemDe(linha)) &&
      !resolvidas.has(linha.id) &&
      ehDocDoLar(linha, cpfs)
    ) {
      resolvidas.set(linha.id, { movement: "transferencia_interna", ...transferencia, regra: "R3b" });
    }
  }

  // R4: estorno na conta.
  for (const linha of vivas) {
    if (
      eEntradaBanco(linha) &&
      ENTRADA_R4.has(origemDe(linha)) &&
      !resolvidas.has(linha.id) &&
      ESTORNO_RE.test(textoDe(linha))
    ) {
      resolvidas.set(linha.id, { movement: "estorno", ...mantem(linha), regra: "R4" });
    }
  }

  // R5: rendimento da conta, como renda variável.
  for (const linha of vivas) {
    if (
      eEntradaBanco(linha) &&
      ENTRADA_R5.has(origemDe(linha)) &&
      !resolvidas.has(linha.id) &&
      (origemDe(linha) === "rendimento" ||
        linha.provider_category === "Proceeds interests and dividends" ||
        RENDIMENTO_RE.test(textoDe(linha)))
    ) {
      resolvidas.set(linha.id, {
        movement: "rendimento",
        income_kind: "variavel",
        income_subtype: "rendimento",
        regra: "R5",
      });
    }
  }

  // R6: resgate de caixinha ou investimento, que é dinheiro do casal voltando.
  for (const linha of vivas) {
    if (
      eEntradaBanco(linha) &&
      ENTRADA_R6.has(origemDe(linha)) &&
      !resolvidas.has(linha.id) &&
      (linha.provider_operation_type === "RESGATE_APLIC_FINANCEIRA" ||
        (linha.provider_category !== null && CATEGORIAS_RESGATE.has(linha.provider_category)) ||
        RESGATE_RE.test(textoDe(linha)))
    ) {
      resolvidas.set(linha.id, { movement: "transferencia_interna", ...transferencia, regra: "R6" });
    }
  }

  return linhas.map((linha): Decisao => {
    if (linha.removed_at !== null) {
      return { id: linha.id, movement: linha.movement, ...mantem(linha), regra: "protegida" };
    }
    if (estaProtegida(linha)) {
      return { id: linha.id, movement: linha.movement, ...mantem(linha), regra: "protegida" };
    }
    const desejado = resolvidas.get(linha.id);
    if (desejado) return { id: linha.id, ...desejado };
    // Marca da IA ou do casal sem regra que a reivindique: o movimento e a marca ficam como estão.
    if (!ehDaClassificacao(linha)) {
      return { id: linha.id, movement: linha.movement, ...mantem(linha), regra: "marca-alheia" };
    }
    return { id: linha.id, movement: origemDe(linha), ...semMarcaPropria(linha), regra: "sem-regra" };
  });
}
