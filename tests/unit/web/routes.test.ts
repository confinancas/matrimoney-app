import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { type Aba, type Frame, type RotaMeta, resolveActiveTab } from "@/app/frame/aba";
import { criarRotas, ROTAS } from "@/routes";

// A convenção de rotas (guia de navegação do manual e stack-e-estrutura): caminho, moldura, aba marcada e título.
const CONVENCAO: [string, Frame, Aba | undefined, string][] = [
  ["/", "bare", undefined, "Abertura"],
  ["/entrar", "bare", undefined, "Entrar"],
  ["/criar-conta", "bare", undefined, "Criar conta"],
  ["/convite/:token", "bare", undefined, "Aceitar convite"],
  ["/recuperar/:token", "bare", undefined, "Recuperar acesso"],
  ["/configuracao-inicial", "bare", undefined, "Configuração inicial"],
  ["/inicio", "tab", "inicio", "Início"],
  ["/cartoes", "tab", "cartoes", "Cartões"],
  ["/contas", "tab", "contas", "Contas do mês"],
  ["/renda", "tab", "renda", "Renda"],
  ["/relatorio/:cycleKey?", "tab", "relatorio", "Relatório"],
  ["/configuracoes", "tab", "configuracoes", "Configurações"],
  ["/notificacoes", "detail", "inicio", "Notificações"],
  ["/para-categorizar", "detail", "inicio", "Para categorizar"],
  ["/pix/:transactionId", "detail", "inicio", "Pix enviado"],
  ["/cartoes/:cardId", "detail", "cartoes", "Cartão"],
  ["/compras/:transactionId", "detail", "cartoes", "Compra"],
  ["/pix-recebido/:transactionId", "detail", "renda", "Pix recebido"],
  ["/renda/fixa", "detail", "renda", "Renda fixa"],
  ["/pix-do-mes/:cycleKey?", "detail", "relatorio", "Pix do mês"],
  ["/configuracoes/bancos/:bankItemId", "detail", "configuracoes", "Banco conectado"],
  ["/configuracoes/categorias", "detail", "configuracoes", "Categorias"],
  ["/configuracoes/regras", "detail", "configuracoes", "Regras"],
  ["/configuracoes/documento-ia", "detail", "configuracoes", "Documento de regras da IA"],
  ["/configuracoes/dados", "detail", "configuracoes", "Dados"],
  ["/configuracoes/claude", "detail", "configuracoes", "Claude e assistente"],
  ["/assistente", "full", "ia", "Assistente"],
  ["/categorias/escolher", "full", "cartoes", "Escolher categoria"],
  ["/categorias/nova", "full", "cartoes", "Nova categoria"],
  ["/contas/nova", "full", "contas", "Nova conta fixa"],
  ["/contas/pagamentos", "full", "contas", "Pagamentos do ciclo"],
  ["/contas/:fixedBillId", "full", "contas", "Conta fixa"],
  ["/configuracoes/tipos-de-gasto", "full", "configuracoes", "Tipos de gasto"],
  ["/configuracoes/casal/adicionar-conjuge", "full", "configuracoes", "Adicionar cônjuge"],
  ["/configuracoes/bancos/conectar", "full", "configuracoes", "Conectar Meu Pluggy"],
  ["*", "detail", undefined, "Página não encontrada"],
];

function metaDe(caminho: string): RotaMeta {
  const rota = ROTAS.find((item) => item.path === caminho);
  if (!rota) throw new Error(`rota ausente: ${caminho}`);
  const { frame, tab, title, requer } = rota;
  return { frame, tab, title, requer };
}

describe("tabela de rotas", () => {
  it.each(CONVENCAO)("%s: moldura %s, aba %s, título %s", (caminho, moldura, aba, titulo) => {
    const rota = ROTAS.find((item) => item.path === caminho);

    expect(rota?.frame).toBe(moldura);
    expect(rota?.tab).toBe(aba);
    expect(rota?.title).toBe(titulo);
  });

  it("tem todas as rotas da convenção e nenhuma sobrando (fora o catálogo de desenvolvimento)", () => {
    const caminhos = ROTAS.map((rota) => rota.path).filter((caminho) => caminho !== "/dev/catalogo");

    expect(caminhos.sort()).toEqual(CONVENCAO.map(([caminho]) => caminho).sort());
  });

  it("só o assistente exige a flag, e é a rota /assistente", () => {
    expect(ROTAS.filter((rota) => rota.requer).map((rota) => rota.path)).toEqual(["/assistente"]);
  });

  it("o catálogo fica nas rotas quando __DEV_ROUTES__ é verdadeiro (como nos testes)", () => {
    expect(ROTAS.some((rota) => rota.path === "/dev/catalogo")).toBe(true);
  });
});

describe("resolveActiveTab", () => {
  it("rota de aba usa a própria aba, mesmo com fromTab", () => {
    expect(resolveActiveTab(metaDe("/cartoes"), { fromTab: "inicio" })).toBe("cartoes");
  });

  it("detalhe marca a aba da tabela: compra marca Cartões, Pix recebido marca Renda, banco marca Configurações", () => {
    expect(resolveActiveTab(metaDe("/compras/:transactionId"), undefined)).toBe("cartoes");
    expect(resolveActiveTab(metaDe("/pix-recebido/:transactionId"), undefined)).toBe("renda");
    expect(resolveActiveTab(metaDe("/configuracoes/bancos/:bankItemId"), undefined)).toBe("configuracoes");
  });

  it("tela cheia com fromTab válido marca a aba de origem (Início)", () => {
    expect(resolveActiveTab(metaDe("/categorias/escolher"), { fromTab: "inicio" })).toBe("inicio");
  });

  it("tela cheia sem estado marca a aba da tabela (Cartões)", () => {
    expect(resolveActiveTab(metaDe("/categorias/escolher"), undefined)).toBe("cartoes");
  });

  it("fromTab inválido é ignorado", () => {
    expect(resolveActiveTab(metaDe("/categorias/escolher"), { fromTab: "nada" })).toBe("cartoes");
    expect(resolveActiveTab(metaDe("/categorias/escolher"), { fromTab: 3 })).toBe("cartoes");
    expect(resolveActiveTab(metaDe("/categorias/escolher"), "inicio")).toBe("cartoes");
  });

  it("detalhe sem aba na tabela (não encontrada) não marca nenhuma", () => {
    expect(resolveActiveTab(metaDe("*"), undefined)).toBeNull();
  });

  it("rota bare não marca aba", () => {
    expect(resolveActiveTab(metaDe("/entrar"), { fromTab: "inicio" })).toBeNull();
  });
});

describe("criarRotas", () => {
  it("troca a tela provisória pela do app, mantendo a moldura da rota", () => {
    const tela = createElement("p", null, "Tela do app");
    const [layout] = criarRotas({ "/inicio": tela });
    const filhos = layout?.children ?? [];
    const inicio = filhos.find((filho) => filho.path === "/inicio");

    expect(inicio?.element).toBe(tela);
    expect(inicio?.handle).toEqual({ frame: "tab", tab: "inicio", title: "Início" });
  });

  it("recusa tela para uma rota que não existe", () => {
    expect(() => criarRotas({ "/nao-existe": createElement("p", null, "x") })).toThrow(
      /rota que não existe: \/nao-existe/,
    );
  });
});
