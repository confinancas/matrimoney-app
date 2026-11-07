// Ciclo financeiro (TASK-0801): datas e calendário, puros. Datas são strings AAAA-MM-DD e a aritmética é em UTC
// (Date.UTC). Nunca new Date(texto local). "Hoje" é sempre todayInSaoPaulo(agora).
export { todayInSaoPaulo } from "./sao-paulo-date";

export type Ciclo = { key: string; startsOn: string; endsOn: string };

export const DIA_DE_INICIO = { min: 1, max: 28 } as const;

const AAAA_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;
const AAAA_MM = /^\d{4}-\d{2}$/;
const MS_POR_DIA = 86_400_000;
const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

// Data de calendário a partir de ano, mês (1 a 12, ou fora disso: Date.UTC normaliza) e dia.
function ymd(ano: number, mes: number, dia: number): string {
  return new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);
}

function partes(data: string): [number, number, number] {
  return [Number(data.slice(0, 4)), Number(data.slice(5, 7)), Number(data.slice(8, 10))];
}

function utc(data: string): number {
  const [ano, mes, dia] = partes(data);
  return Date.UTC(ano, mes - 1, dia);
}

export function daysInMonth(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export function isYmd(texto: unknown): texto is string {
  if (typeof texto !== "string") return false;
  const casa = AAAA_MM_DD.exec(texto);
  if (!casa) return false;
  const ano = Number(casa[1]);
  const mes = Number(casa[2]);
  const dia = Number(casa[3]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= daysInMonth(ano, mes);
}

function exigeData(data: string): void {
  if (!isYmd(data)) throw new RangeError("data de calendário inválida (use AAAA-MM-DD)");
}

export function exigeDiaDeInicio(dia: number): void {
  if (!Number.isInteger(dia) || dia < DIA_DE_INICIO.min || dia > DIA_DE_INICIO.max) {
    throw new RangeError("o dia de início vai de 1 a 28");
  }
}

export function addDays(data: string, dias: number): string {
  exigeData(data);
  const [ano, mes, dia] = partes(data);
  return ymd(ano, mes, dia + dias);
}

// b − a, em dias.
export function daysBetween(a: string, b: string): number {
  exigeData(a);
  exigeData(b);
  return Math.round((utc(b) - utc(a)) / MS_POR_DIA);
}

// Soma meses e prende o dia no último do mês de destino (31/01 + 1 mês = 28/02 ou 29/02).
export function addMonthsClamped(data: string, meses: number): string {
  exigeData(data);
  const [ano, mes, dia] = partes(data);
  const total = ano * 12 + (mes - 1) + meses;
  const anoNovo = Math.floor(total / 12);
  const mesNovo = (((total % 12) + 12) % 12) + 1;
  return ymd(anoNovo, mesNovo, Math.min(dia, daysInMonth(anoNovo, mesNovo)));
}

// Ciclo que começa em `inicio` e termina no dia `dia` do mês que está `meses` depois, menos um. A chave é o mês do início.
function cicloQueComeca(inicio: string, dia: number, meses: number): Ciclo {
  const [ano, mes] = partes(inicio);
  const fim = addDays(ymd(ano, mes + meses, dia), -1);
  return { key: inicio.slice(0, 7), startsOn: inicio, endsOn: fim };
}

// O ciclo padrão que contém a data: começa no dia de início do mês da data (ou do mês anterior, se a data é antes).
export function standardCycle(data: string, dia: number): Ciclo {
  exigeData(data);
  exigeDiaDeInicio(dia);
  const [ano, mes, diaDaData] = partes(data);
  const inicio = diaDaData >= dia ? ymd(ano, mes, dia) : ymd(ano, mes - 1, dia);
  return cicloQueComeca(inicio, dia, 1);
}

// Ciclo seguinte ao que termina em `fimAnterior`, com o dia de início `dia`. Com o mesmo dia, é o ciclo padrão;
// com dia novo, é o ciclo de transição. Transição mínima (Gustavo, 2026-11-07): nenhum ciclo tem menos de 15 dias.
// Se a transição daria menos, ela termina no dia de início do mês seguinte ao primeiro fim, menos um, e emenda
// com o ciclo seguinte (o mês do meio fica sem chave).
export function cycleAfter(fimAnterior: string, dia: number): Ciclo {
  exigeData(fimAnterior);
  exigeDiaDeInicio(dia);
  const inicio = addDays(fimAnterior, 1);
  const ciclo = cicloQueComeca(inicio, dia, 1);
  const dias = daysBetween(ciclo.startsOn, ciclo.endsOn) + 1;
  return dias < 15 ? cicloQueComeca(inicio, dia, 2) : ciclo;
}

// Ciclo anterior ao que começa em `inicioSeguinte`: termina no dia antes dele e começa no dia `dia` do mês anterior.
// Com o dia padrão, é o ciclo padrão; com o dia de início anterior ao corte, é um ciclo de transição.
export function cycleBefore(inicioSeguinte: string, dia: number): Ciclo {
  exigeData(inicioSeguinte);
  exigeDiaDeInicio(dia);
  const [ano, mes] = partes(inicioSeguinte);
  const inicio = ymd(ano, mes - 1, dia);
  return { key: inicio.slice(0, 7), startsOn: inicio, endsOn: addDays(inicioSeguinte, -1) };
}

// Ciclo do calendário que contém a data, ou null quando o calendário não a cobre. O calendário é ordenado por startsOn.
export function cycleForDate(data: string, calendario: readonly Ciclo[]): Ciclo | null {
  exigeData(data);
  let baixo = 0;
  let alto = calendario.length - 1;
  let achado = -1;
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1;
    const candidato = calendario[meio];
    if (candidato && candidato.startsOn <= data) {
      achado = meio;
      baixo = meio + 1;
    } else {
      alto = meio - 1;
    }
  }
  const ciclo = calendario[achado];
  if (achado < 0 || !ciclo) return null;
  return data <= ciclo.endsOn ? ciclo : null;
}

// Posição da data no ciclo: 1 no primeiro dia.
export function dayIndex(data: string, ciclo: Ciclo): number {
  return daysBetween(ciclo.startsOn, data) + 1;
}

export function totalDays(ciclo: Ciclo): number {
  return daysBetween(ciclo.startsOn, ciclo.endsOn) + 1;
}

// Dias que faltam contando hoje: 1 no último dia.
export function daysLeftIncludingToday(data: string, ciclo: Ciclo): number {
  return daysBetween(data, ciclo.endsOn) + 1;
}

// O mesmo dia do ciclo anterior, sem passar do fim dele (dia 31 contra um anterior de 28 dias dá o último dia).
export function sameDayInPrevious(indice: number, anterior: Ciclo): string {
  const dia = addDays(anterior.startsOn, indice - 1);
  if (dia > anterior.endsOn) return anterior.endsOn;
  return dia;
}

export function cycleLabel(key: string): string {
  if (!AAAA_MM.test(key)) throw new RangeError("chave de ciclo inválida (use AAAA-MM)");
  const mes = Number(key.slice(5, 7));
  const nome = MESES[mes - 1];
  if (!nome) throw new RangeError("mês da chave fora de 01 a 12");
  return nome;
}

const ordenados = (lista: readonly Ciclo[]): Ciclo[] =>
  [...lista].sort((x, y) => (x.startsOn < y.startsOn ? -1 : x.startsOn > y.startsOn ? 1 : 0));

// Ciclos que faltam para o calendário cobrir [de, ate]. Sem nenhum, começa no ciclo padrão que contém `de`.
// Para trás, cada ciclo novo termina no dia antes do primeiro existente; para a frente, depois do último.
export function ciclosQueFaltam(existentes: readonly Ciclo[], dia: number, de: string, ate: string): Ciclo[] {
  exigeData(de);
  exigeData(ate);
  exigeDiaDeInicio(dia);
  if (de > ate) throw new RangeError("o início do intervalo é depois do fim");
  const calendario = ordenados(existentes);
  if (calendario.length === 0) {
    const lista = [standardCycle(de, dia)];
    for (let ultimo = lista[0]; ultimo && ultimo.endsOn < ate; ultimo = lista[lista.length - 1]) {
      const proximo = cycleAfter(ultimo.endsOn, dia);
      lista.push(proximo);
    }
    return lista;
  }

  const antes: Ciclo[] = [];
  let primeiro = calendario[0];
  while (primeiro && de < primeiro.startsOn) {
    const anterior = cycleBefore(primeiro.startsOn, dia);
    antes.unshift(anterior);
    primeiro = anterior;
  }
  const depois: Ciclo[] = [];
  let ultimo = calendario[calendario.length - 1];
  while (ultimo && ate > ultimo.endsOn) {
    const seguinte = cycleAfter(ultimo.endsOn, dia);
    depois.push(seguinte);
    ultimo = seguinte;
  }
  return [...antes, ...depois];
}

export type PlanoDeReconstrucao = {
  // Ciclos que o calendário ganha para cobrir hoje com o dia antigo, até o ciclo atual (passados e o atual).
  acrescentar: Ciclo[];
  // Apaga-se o que começa depois do fim deste dia (o ciclo atual).
  fimDoAtual: string;
  // Ciclos futuros refeitos com o dia novo, a partir do ciclo atual, até cobrir o horizonte antigo.
  novosFuturos: Ciclo[];
  // Falso quando não há nenhum ciclo futuro nem nada a acrescentar: o calendário fica como está.
  mudaCalendario: boolean;
};

// Planeja a mudança do dia de início: o ciclo que contém hoje fica como estava; os futuros são refeitos com o dia novo.
export function planejarReconstrucao(
  existentes: readonly Ciclo[],
  diaAntigo: number,
  diaNovo: number,
  hoje: string,
): PlanoDeReconstrucao {
  exigeDiaDeInicio(diaNovo);
  const faltamHoje = ciclosQueFaltam(existentes, diaAntigo, hoje, hoje);
  const calendario = ordenados([...existentes, ...faltamHoje]);
  const atual = cycleForDate(hoje, calendario);
  const ultimo = calendario[calendario.length - 1];
  if (!atual || !ultimo) throw new RangeError("o calendário não cobre hoje");

  const futuros = calendario.filter((ciclo) => ciclo.startsOn > atual.endsOn);
  const novosFuturos: Ciclo[] = [];
  if (futuros.length > 0) {
    let fim = atual.endsOn;
    while (fim < ultimo.endsOn) {
      const novo = cycleAfter(fim, diaNovo);
      novosFuturos.push(novo);
      fim = novo.endsOn;
    }
  }
  return {
    acrescentar: faltamHoje.filter((ciclo) => ciclo.startsOn <= atual.endsOn),
    fimDoAtual: atual.endsOn,
    novosFuturos,
    mudaCalendario: futuros.length > 0 || faltamHoje.length > 0,
  };
}
