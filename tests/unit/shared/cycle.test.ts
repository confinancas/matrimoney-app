import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  type Ciclo,
  ciclosQueFaltam,
  cycleAfter,
  cycleBefore,
  cycleForDate,
  cycleLabel,
  dayIndex,
  daysBetween,
  daysInMonth,
  daysLeftIncludingToday,
  isYmd,
  planejarReconstrucao,
  sameDayInPrevious,
  standardCycle,
  totalDays,
} from "../../../src/shared/cycle";

const INICIO = "2025-01-01";
const FIM = "2029-12-31";

// Encadeia os ciclos a partir de um, para a frente, até passar do fim.
function encadeados(primeiro: Ciclo, dia: number, ate: string): Ciclo[] {
  const lista = [primeiro];
  let ultimo = primeiro;
  while (ultimo.endsOn < ate) {
    ultimo = cycleAfter(ultimo.endsOn, dia);
    lista.push(ultimo);
  }
  return lista;
}

describe("datas de calendário", () => {
  it("isYmd aceita só AAAA-MM-DD que existe", () => {
    expect(isYmd("2028-02-29")).toBe(true);
    expect(isYmd("2027-02-29")).toBe(false);
    expect(isYmd("2026-13-01")).toBe(false);
    expect(isYmd("2026-11-10T00:00:00.000Z")).toBe(false);
    expect(isYmd("10/11/2026")).toBe(false);
    expect(isYmd(null)).toBe(false);
  });

  it("aritmética de dias e meses em UTC, com o dia preso no último do mês", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-11-10", "2026-11-11")).toBe(1);
    expect(daysBetween("2026-10-11", "2026-11-10")).toBe(30);
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
  });

  it("dia de início fora de 1 a 28 é RangeError", () => {
    for (const dia of [0, 29, 11.5, Number.NaN]) {
      expect(() => standardCycle("2026-11-10", dia)).toThrow(RangeError);
      expect(() => cycleAfter("2026-11-10", dia)).toThrow(RangeError);
      expect(() => cycleBefore("2026-11-11", dia)).toThrow(RangeError);
    }
    expect(() => standardCycle("10/11/2026", 11)).toThrow(RangeError);
  });
});

describe("standardCycle: a varredura exaustiva", () => {
  it("para todo dia de início de 1 a 28 e toda data de 2025 a 2029: contém a data, a chave é o mês do início, dura de 28 a 31 dias e começa no dia de início", () => {
    const falhas: string[] = [];
    for (let dia = 1; dia <= 28; dia++) {
      const diaTexto = String(dia).padStart(2, "0");
      let data = INICIO;
      while (data <= FIM) {
        const ciclo = standardCycle(data, dia);
        const dura = totalDays(ciclo);
        if (!(data >= ciclo.startsOn && data <= ciclo.endsOn)) falhas.push(`${dia} ${data}: não contém`);
        if (ciclo.key !== ciclo.startsOn.slice(0, 7)) falhas.push(`${dia} ${data}: chave`);
        if (dura < 28 || dura > 31) falhas.push(`${dia} ${data}: duração ${dura}`);
        if (ciclo.startsOn.slice(8) !== diaTexto) falhas.push(`${dia} ${data}: início ${ciclo.startsOn}`);
        data = addDays(data, 1);
      }
    }
    expect(falhas).toEqual([]);
  });

  it("para todo dia de início: a sequência de ciclos a partir de 2025 é contígua, com chaves únicas e crescentes", () => {
    const falhas: string[] = [];
    for (let dia = 1; dia <= 28; dia++) {
      const sequencia = encadeados(standardCycle(INICIO, dia), dia, FIM);
      for (let i = 1; i < sequencia.length; i++) {
        const anterior = sequencia[i - 1];
        const atual = sequencia[i];
        if (!anterior || !atual) continue;
        if (atual.startsOn !== addDays(anterior.endsOn, 1))
          falhas.push(`${dia}: buraco em ${atual.startsOn}`);
        if (atual.key <= anterior.key) falhas.push(`${dia}: chave ${atual.key} não cresce`);
      }
    }
    expect(falhas).toEqual([]);
  });
});

describe("cenários do ciclo", () => {
  it("1. fronteira do dia 10/11 com início 11", () => {
    expect(standardCycle("2026-11-10", 11).key).toBe("2026-10");
    expect(standardCycle("2026-11-11", 11).key).toBe("2026-11");
  });

  it("2. fatura que fecha no dia 9 vai para o ciclo de outubro; fecha no dia 11 vai para novembro", () => {
    expect(standardCycle("2026-11-09", 11).key).toBe("2026-10");
    expect(standardCycle("2026-11-11", 11).key).toBe("2026-11");
  });

  it("3. fatura que fecha em 03/11 conta em outubro, mesmo a compra sendo de 05/10", () => {
    expect(standardCycle("2026-11-03", 11).key).toBe("2026-10");
  });

  it("4. virada de ano: 05/01/2027 e 11/12/2026 em 2026-12; 11/01/2027 em 2027-01", () => {
    expect(standardCycle("2027-01-05", 11).key).toBe("2026-12");
    expect(standardCycle("2026-12-11", 11).key).toBe("2026-12");
    expect(standardCycle("2027-01-11", 11).key).toBe("2027-01");
  });

  it("5. fim de mês e fevereiro: início 1 faz fevereiro de 2028 com 29 dias; início 28 põe 29/02 em 2028-02, que fecha em 27/03", () => {
    const fevereiroUm = standardCycle("2028-02-10", 1);
    expect(fevereiroUm).toEqual({ key: "2028-02", startsOn: "2028-02-01", endsOn: "2028-02-29" });
    expect(totalDays(fevereiroUm)).toBe(29);
    const fevereiroVinte = standardCycle("2028-02-29", 28);
    expect(fevereiroVinte).toEqual({ key: "2028-02", startsOn: "2028-02-28", endsOn: "2028-03-27" });
  });

  it("6. parcelas: as faturas de 03/11 e de 03/12 caem em 2026-10 e 2026-11", () => {
    expect(standardCycle("2026-11-03", 11).key).toBe("2026-10");
    expect(standardCycle("2026-12-03", 11).key).toBe("2026-11");
  });

  it("7. estorno na fatura que fecha em 03/12 cai em novembro", () => {
    expect(standardCycle("2026-12-03", 11).key).toBe("2026-11");
  });

  it("12. dia, dias e mesmo dia do anterior: no 1º dia e no último, e o dia 31 contra um anterior de 28 dias", () => {
    const marco = standardCycle("2026-03-10", 1);
    expect(marco).toEqual({ key: "2026-03", startsOn: "2026-03-01", endsOn: "2026-03-31" });
    expect(dayIndex("2026-03-01", marco)).toBe(1);
    expect(daysLeftIncludingToday("2026-03-01", marco)).toBe(31);
    expect(dayIndex("2026-03-31", marco)).toBe(31);
    expect(daysLeftIncludingToday("2026-03-31", marco)).toBe(1);
    expect(totalDays(marco)).toBe(31);

    const fevereiro = standardCycle("2026-02-10", 1);
    expect(totalDays(fevereiro)).toBe(28);
    expect(sameDayInPrevious(dayIndex("2026-03-31", marco), fevereiro)).toBe("2026-02-28");
    expect(sameDayInPrevious(dayIndex("2026-03-02", marco), fevereiro)).toBe("2026-02-02");
  });

  it("o rótulo do ciclo é o mês do início", () => {
    expect(cycleLabel("2026-10")).toBe("Outubro");
    expect(cycleLabel("2027-01")).toBe("Janeiro");
    expect(() => cycleLabel("2026-13")).toThrow(RangeError);
  });
});

describe("transições do dia de início", () => {
  it("11 → 5: o ciclo de transição vai de 11/11 a 04/12, e o seguinte de 05/12 a 04/01", () => {
    const transicao = cycleAfter("2026-11-10", 5);
    expect(transicao).toEqual({ key: "2026-11", startsOn: "2026-11-11", endsOn: "2026-12-04" });
    expect(cycleAfter(transicao.endsOn, 5)).toEqual({
      key: "2026-12",
      startsOn: "2026-12-05",
      endsOn: "2027-01-04",
    });
  });

  it("11 → 20 e 11 → 1: os ciclos de transição de 39 e de 20 dias", () => {
    expect(cycleAfter("2026-11-10", 20)).toEqual({
      key: "2026-11",
      startsOn: "2026-11-11",
      endsOn: "2026-12-19",
    });
    expect(cycleAfter("2026-11-10", 1)).toEqual({
      key: "2026-11",
      startsOn: "2026-11-11",
      endsOn: "2026-11-30",
    });
  });

  it("1 → 28: o ciclo de transição tem 58 dias", () => {
    const padrao = standardCycle("2026-11-15", 1);
    const transicao = cycleAfter(padrao.endsOn, 28);
    expect(transicao).toEqual({ key: "2026-12", startsOn: "2026-12-01", endsOn: "2027-01-27" });
    expect(totalDays(transicao)).toBe(58);
  });

  // Transição mínima (Gustavo, 2026-11-07): a fórmula dava 3 dias (de 28/11 a 30/11). Agora emenda com o seguinte.
  it("28 → 1: a transição vai de 28/11 a 31/12 (chave 2026-11); 2026-12 não existe e 01/01 abre 2027-01", () => {
    const padrao = standardCycle("2026-11-07", 28);
    expect(padrao).toEqual({ key: "2026-10", startsOn: "2026-10-28", endsOn: "2026-11-27" });
    const transicao = cycleAfter(padrao.endsOn, 1);
    expect(transicao).toEqual({ key: "2026-11", startsOn: "2026-11-28", endsOn: "2026-12-31" });
    expect(totalDays(transicao)).toBe(34);
    expect(cycleAfter(transicao.endsOn, 1)).toEqual({
      key: "2027-01",
      startsOn: "2027-01-01",
      endsOn: "2027-01-31",
    });
  });

  it("28 → 1 em fevereiro de ano comum (2026) e bissexto (2028): a transição começa em 28/02 e vai até 31/03", () => {
    const comum = cycleAfter("2026-02-27", 1);
    expect(comum).toEqual({ key: "2026-02", startsOn: "2026-02-28", endsOn: "2026-03-31" });
    expect(totalDays(comum)).toBe(32);
    expect(cycleAfter("2026-03-31", 1)).toEqual({
      key: "2026-04",
      startsOn: "2026-04-01",
      endsOn: "2026-04-30",
    });

    const bissexto = cycleAfter("2028-02-27", 1);
    expect(bissexto).toEqual({ key: "2028-02", startsOn: "2028-02-28", endsOn: "2028-03-31" });
    expect(totalDays(bissexto)).toBe(33);
    expect(cycleAfter("2028-03-31", 1)).toEqual({
      key: "2028-04",
      startsOn: "2028-04-01",
      endsOn: "2028-04-30",
    });
  });

  // Limite: "menos de 15". 20 → 5 tem 15 dias e fica como está; 20 → 4 tem 14 e emenda com o seguinte.
  it("20 → 5 tem 15 dias e fica como está; 20 → 4 tem 14 dias e emenda até 03/01/2027", () => {
    expect(cycleAfter("2026-11-19", 5)).toEqual({
      key: "2026-11",
      startsOn: "2026-11-20",
      endsOn: "2026-12-04",
    });
    expect(totalDays(cycleAfter("2026-11-19", 5))).toBe(15);
    expect(cycleAfter("2026-11-19", 4)).toEqual({
      key: "2026-11",
      startsOn: "2026-11-20",
      endsOn: "2027-01-03",
    });
    expect(totalDays(cycleAfter("2026-11-19", 4))).toBe(45);
    expect(cycleAfter("2027-01-03", 4)).toEqual({
      key: "2027-01",
      startsOn: "2027-01-04",
      endsOn: "2027-02-03",
    });
  });

  it("nas transições da spec, as chaves são únicas e os ciclos são contíguos, em cadeia de 6", () => {
    const casos: [number, number, string][] = [
      [11, 5, "2026-11-10"],
      [11, 20, "2026-11-10"],
      [11, 1, "2026-11-10"],
      [28, 1, "2026-11-27"],
      [1, 28, "2026-11-30"],
    ];
    for (const [antigo, novo, fim] of casos) {
      const cadeia: Ciclo[] = [];
      let cursor = fim;
      for (let i = 0; i < 6; i++) {
        const ciclo = cycleAfter(cursor, novo);
        cadeia.push(ciclo);
        cursor = ciclo.endsOn;
      }
      const chaves = new Set(cadeia.map((c) => c.key));
      expect(chaves.size, `${antigo}→${novo}`).toBe(cadeia.length);
      for (let i = 1; i < cadeia.length; i++) {
        const anterior = cadeia[i - 1];
        const atual = cadeia[i];
        expect(atual?.startsOn, `${antigo}→${novo}`).toBe(addDays(anterior?.endsOn ?? "", 1));
      }
    }
  });

  it("ciclo anterior ao calendário: termina no dia antes e começa no dia de início do mês anterior", () => {
    expect(cycleBefore("2026-11-11", 11)).toEqual({
      key: "2026-10",
      startsOn: "2026-10-11",
      endsOn: "2026-11-10",
    });
    expect(cycleBefore("2027-01-05", 11)).toEqual({
      key: "2026-12",
      startsOn: "2026-12-11",
      endsOn: "2027-01-04",
    });
  });
});

const mesmoCiclo = (a: Ciclo, b: Ciclo): boolean =>
  a.key === b.key && a.startsOn === b.startsOn && a.endsOn === b.endsOn;

describe("transição mínima: a varredura exaustiva", () => {
  it("para todo dia antigo × dia novo (28 × 27) e todo mês de início de 2026 a 2028: a transição tem de 15 a 59 dias, é contígua, as chaves são únicas e crescentes, e o ciclo depois é o padrão do dia novo", () => {
    const falhas: string[] = [];
    for (let antigo = 1; antigo <= 28; antigo++) {
      for (let novo = 1; novo <= 28; novo++) {
        if (novo === antigo) continue;
        for (let ano = 2026; ano <= 2028; ano++) {
          for (let mes = 1; mes <= 12; mes++) {
            const rotulo = `${antigo}→${novo} em ${ano}-${mes}`;
            const inicio = `${ano}-${String(mes).padStart(2, "0")}-${String(antigo).padStart(2, "0")}`;
            const anterior = standardCycle(inicio, antigo);
            const transicao = cycleAfter(anterior.endsOn, novo);
            const dias = totalDays(transicao);
            if (dias < 15 || dias > 59) falhas.push(`${rotulo}: ${dias} dias`);

            const cadeia: Ciclo[] = [anterior, transicao];
            for (let i = 0; i < 3; i++) {
              const ultimo = cadeia[cadeia.length - 1];
              if (ultimo) cadeia.push(cycleAfter(ultimo.endsOn, novo));
            }
            for (let i = 1; i < cadeia.length; i++) {
              const previo = cadeia[i - 1];
              const atual = cadeia[i];
              if (!previo || !atual) continue;
              if (atual.startsOn !== addDays(previo.endsOn, 1))
                falhas.push(`${rotulo}: buraco em ${atual.startsOn}`);
              if (atual.key <= previo.key) falhas.push(`${rotulo}: chave ${atual.key} não cresce`);
            }
            const depoisDaTransicao = cadeia[2];
            if (
              depoisDaTransicao &&
              !mesmoCiclo(depoisDaTransicao, standardCycle(depoisDaTransicao.startsOn, novo))
            )
              falhas.push(`${rotulo}: o ciclo depois não é o padrão do dia novo`);
          }
        }
      }
    }
    expect(falhas).toEqual([]);
  });
});

describe("calendário: busca e falta", () => {
  const calendario: Ciclo[] = [
    { key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" },
    { key: "2026-11", startsOn: "2026-11-11", endsOn: "2026-12-10" },
    { key: "2026-12", startsOn: "2026-12-11", endsOn: "2027-01-10" },
  ];

  it("cycleForDate acha o ciclo que contém a data, e null fora do calendário", () => {
    expect(cycleForDate("2026-11-10", calendario)?.key).toBe("2026-10");
    expect(cycleForDate("2026-11-11", calendario)?.key).toBe("2026-11");
    expect(cycleForDate("2027-01-10", calendario)?.key).toBe("2026-12");
    expect(cycleForDate("2026-10-10", calendario)).toBeNull();
    expect(cycleForDate("2027-01-11", calendario)).toBeNull();
    expect(cycleForDate("2026-11-20", [])).toBeNull();
  });

  it("ciclosQueFaltam sem calendário começa no ciclo padrão que contém o início e vai até cobrir o fim", () => {
    const criados = ciclosQueFaltam([], 11, "2026-11-05", "2026-12-20");
    expect(criados.map((c) => c.key)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(criados[0]).toEqual({ key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" });
  });

  it("ciclosQueFaltam com o calendário pronto não cria nada", () => {
    expect(ciclosQueFaltam(calendario, 11, "2026-10-12", "2026-12-20")).toEqual([]);
  });

  it("ciclosQueFaltam para trás e para a frente: chaves novas, contíguas, e nenhuma repetida", () => {
    const faltam = ciclosQueFaltam(calendario, 11, "2026-08-20", "2027-03-01");
    expect(faltam.map((c) => c.key)).toEqual(["2026-08", "2026-09", "2027-01", "2027-02"]);
    expect(faltam[0]).toEqual({ key: "2026-08", startsOn: "2026-08-11", endsOn: "2026-09-10" });
    expect(faltam[1]?.endsOn).toBe("2026-10-10");
    expect(faltam[2]?.startsOn).toBe("2027-01-11");
    expect(() => ciclosQueFaltam(calendario, 11, "2026-12-20", "2026-12-01")).toThrow(RangeError);
  });
});

describe("planejarReconstrucao (o dia 11 vira 5, com hoje em 07/11/2026)", () => {
  const existentes = ciclosQueFaltam([], 11, "2026-09-01", "2027-02-28");

  it("o ciclo atual fica; os futuros são refeitos a partir de 11/11 com o dia novo, até cobrir o horizonte antigo", () => {
    const plano = planejarReconstrucao(existentes, 11, 5, "2026-11-07");
    expect(plano.mudaCalendario).toBe(true);
    expect(plano.acrescentar).toEqual([]);
    expect(plano.fimDoAtual).toBe("2026-11-10");
    expect(plano.novosFuturos.map((c) => c.key)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(plano.novosFuturos[0]).toEqual({ key: "2026-11", startsOn: "2026-11-11", endsOn: "2026-12-04" });
    expect(plano.novosFuturos[1]).toEqual({ key: "2026-12", startsOn: "2026-12-05", endsOn: "2027-01-04" });
  });

  it("sem futuros, não muda o calendário", () => {
    const soAteHoje = ciclosQueFaltam([], 11, "2026-09-01", "2026-11-07");
    const plano = planejarReconstrucao(soAteHoje, 11, 5, "2026-11-07");
    expect(plano.mudaCalendario).toBe(false);
    expect(plano.novosFuturos).toEqual([]);
  });

  it("hoje fora do calendário: o que falta até hoje entra como passado, com o dia antigo", () => {
    const soDoPassado = ciclosQueFaltam([], 11, "2026-08-01", "2026-08-31");
    const plano = planejarReconstrucao(soDoPassado, 11, 5, "2026-11-07");
    expect(plano.acrescentar.map((c) => c.key)).toEqual(["2026-09", "2026-10"]);
    expect(plano.acrescentar.every((c) => c.startsOn <= plano.fimDoAtual)).toBe(true);
    expect(plano.novosFuturos).toEqual([]);
  });
});
