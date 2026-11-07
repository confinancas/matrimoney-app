import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import { Abertura } from "./app/Abertura";
import type { Aba, Frame, RotaMeta } from "./app/frame/aba";
import { Moldura } from "./app/Moldura";
import { NotFound } from "./app/NotFound";
import { PlaceholderScreen } from "./app/PlaceholderScreen";
import { Catalogo } from "./dev/Catalog";
import { EscolherCategoria } from "./screens/categorias/EscolherCategoria";
import { NovaCategoria } from "./screens/categorias/NovaCategoria";

// Telas que um app põe no lugar das provisórias, pelo path da rota da tabela.
export type TelasDoApp = Partial<Record<string, ReactNode>>;

export type RotaDaTabela = RotaMeta & { path: string; element: ReactNode };

const provisoria = <PlaceholderScreen />;

// Tabela de rotas da convenção. Cada épico troca o PlaceholderScreen pela tela de verdade.
export const ROTAS: RotaDaTabela[] = [
  { path: "/", frame: "bare", title: "Abertura", element: <Abertura /> },
  { path: "/entrar", frame: "bare", title: "Entrar", element: provisoria },
  { path: "/criar-conta", frame: "bare", title: "Criar conta", element: provisoria },
  { path: "/convite/:token", frame: "bare", title: "Aceitar convite", element: provisoria },
  { path: "/recuperar/:token", frame: "bare", title: "Recuperar acesso", element: provisoria },
  { path: "/configuracao-inicial", frame: "bare", title: "Configuração inicial", element: provisoria },

  { path: "/inicio", frame: "tab", tab: "inicio", title: "Início", element: provisoria },
  { path: "/cartoes", frame: "tab", tab: "cartoes", title: "Cartões", element: provisoria },
  { path: "/contas", frame: "tab", tab: "contas", title: "Contas do mês", element: provisoria },
  { path: "/renda", frame: "tab", tab: "renda", title: "Renda", element: provisoria },
  { path: "/relatorio/:cycleKey?", frame: "tab", tab: "relatorio", title: "Relatório", element: provisoria },
  { path: "/configuracoes", frame: "tab", tab: "configuracoes", title: "Configurações", element: provisoria },

  { path: "/notificacoes", frame: "detail", tab: "inicio", title: "Notificações", element: provisoria },
  {
    path: "/para-categorizar",
    frame: "detail",
    tab: "inicio",
    title: "Para categorizar",
    element: provisoria,
  },
  { path: "/pix/:transactionId", frame: "detail", tab: "inicio", title: "Pix enviado", element: provisoria },

  { path: "/cartoes/:cardId", frame: "detail", tab: "cartoes", title: "Cartão", element: provisoria },
  { path: "/compras/:transactionId", frame: "detail", tab: "cartoes", title: "Compra", element: provisoria },

  {
    path: "/pix-recebido/:transactionId",
    frame: "detail",
    tab: "renda",
    title: "Pix recebido",
    element: provisoria,
  },
  { path: "/renda/fixa", frame: "detail", tab: "renda", title: "Renda fixa", element: provisoria },

  {
    path: "/pix-do-mes/:cycleKey?",
    frame: "detail",
    tab: "relatorio",
    title: "Pix do mês",
    element: provisoria,
  },

  {
    path: "/configuracoes/bancos/:bankItemId",
    frame: "detail",
    tab: "configuracoes",
    title: "Banco conectado",
    element: provisoria,
  },
  {
    path: "/configuracoes/categorias",
    frame: "detail",
    tab: "configuracoes",
    title: "Categorias",
    element: provisoria,
  },
  {
    path: "/configuracoes/regras",
    frame: "detail",
    tab: "configuracoes",
    title: "Regras",
    element: provisoria,
  },
  {
    path: "/configuracoes/documento-ia",
    frame: "detail",
    tab: "configuracoes",
    title: "Documento de regras da IA",
    element: provisoria,
  },
  {
    path: "/configuracoes/dados",
    frame: "detail",
    tab: "configuracoes",
    title: "Dados",
    element: provisoria,
  },

  {
    path: "/assistente",
    frame: "full",
    tab: "ia",
    title: "Assistente",
    requer: "assistente",
    element: provisoria,
  },

  {
    path: "/categorias/escolher",
    frame: "full",
    tab: "cartoes",
    title: "Escolher categoria",
    element: <EscolherCategoria />,
  },
  {
    path: "/categorias/nova",
    frame: "full",
    tab: "cartoes",
    title: "Nova categoria",
    element: <NovaCategoria />,
  },

  { path: "/contas/nova", frame: "full", tab: "contas", title: "Nova conta fixa", element: provisoria },
  {
    path: "/contas/pagamentos",
    frame: "full",
    tab: "contas",
    title: "Pagamentos do ciclo",
    element: provisoria,
  },
  { path: "/contas/:fixedBillId", frame: "full", tab: "contas", title: "Conta fixa", element: provisoria },

  {
    path: "/configuracoes/tipos-de-gasto",
    frame: "full",
    tab: "configuracoes",
    title: "Tipos de gasto",
    element: provisoria,
  },
  {
    path: "/configuracoes/casal/adicionar-conjuge",
    frame: "full",
    tab: "configuracoes",
    title: "Adicionar cônjuge",
    element: provisoria,
  },
  {
    path: "/configuracoes/bancos/conectar",
    frame: "full",
    tab: "configuracoes",
    title: "Conectar Meu Pluggy",
    element: provisoria,
  },

  { path: "*", frame: "detail", title: "Página não encontrada", element: <NotFound /> },

  // Catálogo do design system: só fora do build de produção (__DEV_ROUTES__ vira false nele).
  ...(__DEV_ROUTES__
    ? [
        {
          path: "/dev/catalogo",
          frame: "bare" as Frame,
          title: "Catálogo do design system",
          element: <Catalogo />,
        },
      ]
    : []),
];

// Rotas do roteador: a moldura é o layout de todas. Uma tela do app, quando há, troca a provisória (ou a da tabela).
export function criarRotas(telas: TelasDoApp = {}): RouteObject[] {
  const caminhos = new Set(ROTAS.map((rota) => rota.path));
  for (const caminho of Object.keys(telas)) {
    if (!caminhos.has(caminho)) throw new Error(`Tela para uma rota que não existe: ${caminho}`);
  }

  return [
    {
      element: <Moldura />,
      children: ROTAS.map((rota) => ({
        path: rota.path,
        element: telas[rota.path] ?? rota.element,
        handle: metaDaRota(rota),
      })),
    },
  ];
}

function metaDaRota(rota: RotaDaTabela): RotaMeta {
  const meta: RotaMeta = { frame: rota.frame, title: rota.title };
  if (rota.tab !== undefined) meta.tab = rota.tab as Aba;
  if (rota.requer !== undefined) meta.requer = rota.requer;
  return meta;
}
