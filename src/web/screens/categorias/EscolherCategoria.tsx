// biome-ignore-all lint/a11y/useSemanticElements: a lista pede botões com role radio (protótipo), não o radio nativo
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { CategoryDot } from "@/components/CategoryDot";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  buildCategoryTree,
  type CategoryDTO,
  type CategoryNode,
  filtrarCategorias,
} from "../../../shared/categories";
import { fetchCategories } from "../../api/categories";
import {
  applyRetroactive,
  type Categorizacao,
  fetchCategorization,
  saveTransactionCategory,
} from "../../api/rules";
import { destinoDeVoltar } from "../../app/frame/aba";
import { useRotaAtual } from "../../app/rota-atual";
import { ApiError } from "../../lib/api";
import { caminhoSeguro } from "./voltar";

// Voltas do retroativo numa mesma tela: cada volta grava até 2.000 linhas; o limite evita laço sem fim.
const MAXIMO_DE_VOLTAS = 50;

type LinhaProps = {
  categoria: CategoryDTO;
  sub: boolean;
  marcada: boolean;
  sugerida: boolean;
  aoEscolher: (id: string) => void;
};

// Uma linha da lista: categoria (bolinha cheia) ou subcategoria (anel, recuada).
function LinhaCategoria({ categoria, sub, marcada, sugerida, aoEscolher }: LinhaProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={() => aoEscolher(categoria.id)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-[16px] pr-3.5 text-left font-sans transition-colors",
        sub ? "min-h-[46px] pl-9" : "min-h-[52px] pl-3.5",
        marcada ? "bg-primary-soft" : "bg-transparent",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <CategoryDot cor={categoria.color} sub={sub} />
        <span className="text-[15px] font-medium text-ink">{categoria.name}</span>
        {sugerida && (
          <span className="shrink-0 rounded-full border border-chip-border px-2 py-0.5 text-[11px] font-semibold text-primary">
            sugestão da IA
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
          marcada ? "border-primary" : "border-switch-off-border",
        )}
      >
        {marcada && <span className="size-2.5 rounded-full bg-primary" />}
      </span>
    </button>
  );
}

// Escolhe a categoria de uma compra (ou de outra coisa) e devolve a escolha a quem abriu o seletor.
export function EscolherCategoria() {
  const navegar = useNavigate();
  const localizacao = useLocation();
  const [params] = useSearchParams();
  const { aba } = useRotaAtual();

  // Volta da tela Nova categoria com state.categoriaCriada: essa categoria já vem selecionada.
  const criadaAgora = (localizacao.state as { categoriaCriada?: unknown } | null)?.categoriaCriada;
  const [selecionada, setSelecionada] = useState<string | null>(() =>
    typeof criadaAgora === "string" ? criadaAgora : params.get("selecionada"),
  );
  // Com transacao, a compra traz a categoria e a sugestão da IA; sem ela, o seletor segue como na TASK-0301.
  const transacao = params.get("transacao");
  const [categorizacao, setCategorizacao] = useState<Categorizacao | null>(null);
  const [falhaCategorizacao, setFalhaCategorizacao] = useState(false);
  const [aplicarTodas, setAplicarTodas] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [falhaRetroativo, setFalhaRetroativo] = useState<string | null>(null);
  const sugerida = categorizacao?.aiCategoryId ?? params.get("sugerida");
  const voltar = caminhoSeguro(params.get("voltar"));
  const caminhoAtual = `${localizacao.pathname}${localizacao.search}`;

  const [categorias, setCategorias] = useState<CategoryDTO[] | null>(null);
  const [falha, setFalha] = useState<ApiError | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (transacao === null) return;
    let ativa = true;
    fetchCategorization(transacao).then(
      (dados) => {
        if (!ativa) return;
        setCategorizacao(dados);
        setSelecionada((atual) => atual ?? dados.categoryId);
      },
      () => {
        if (ativa) setFalhaCategorizacao(true);
      },
    );
    return () => {
      ativa = false;
    };
  }, [transacao]);

  // O switch vale só para compra (estabelecimento com rótulo), e liga por padrão.
  const podeAplicarATodas =
    categorizacao !== null &&
    categorizacao.scope === "estabelecimento" &&
    (categorizacao.matchLabel ?? "") !== "";
  const aplicar = podeAplicarATodas && aplicarTodas;

  // Cada carga tem um número: só a última ainda vale (a que ficou para trás não mostra nada).
  const partida = useRef(0);
  const carregar = useCallback(() => {
    const esta = ++partida.current;
    setFalha(null);
    fetchCategories().then(
      (lista) => {
        if (esta === partida.current) setCategorias(lista);
      },
      (erro: unknown) => {
        if (esta !== partida.current) return;
        setFalha(erro instanceof ApiError ? erro : new ApiError(0, "erro_http", "Algo deu errado."));
      },
    );
  }, []);

  useEffect(() => {
    carregar();
    return () => {
      partida.current++;
    };
  }, [carregar]);

  const arvore = useMemo(() => (categorias === null ? [] : buildCategoryTree(categorias)), [categorias]);
  const visivel: CategoryNode[] = filtrarCategorias(arvore, busca);
  const buscando = busca.trim() !== "";

  function caminhoNovaCategoria(extra: Record<string, string>): string {
    return `/categorias/nova?${new URLSearchParams({ ...extra, voltar: caminhoAtual }).toString()}`;
  }

  // Volta com a categoria escolhida (sem estado, se não há voltar).
  function concluir(categoria: string) {
    if (voltar !== null) navegar(voltar, { state: { categoriaEscolhida: categoria } });
    else navegar(-1);
  }

  // Repete a fatia do retroativo até zerar. Falha no meio: fica o "Tentar de novo". Se outra regra assumiu o
  // estabelecimento (409), esta termina e volta: a outra cuida do resto.
  async function continuarRetroativo(regraId: string, categoria: string): Promise<void> {
    setFalhaRetroativo(null);
    for (let volta = 0; volta < MAXIMO_DE_VOLTAS; volta++) {
      try {
        const fatia = await applyRetroactive(regraId);
        setProgresso(fatia.remaining);
        if (fatia.remaining <= 0) {
          concluir(categoria);
          return;
        }
      } catch (erro) {
        if (erro instanceof ApiError && erro.code === "regra_inativa") {
          concluir(categoria);
          return;
        }
        setFalhaRetroativo(regraId);
        return;
      }
    }
    setFalhaRetroativo(regraId);
  }

  async function salvar() {
    if (selecionada === null || salvando) return;
    if (transacao === null) {
      concluir(selecionada);
      return;
    }
    setSalvando(true);
    setErroSalvar(false);
    try {
      const resultado = await saveTransactionCategory(transacao, {
        categoryId: selecionada,
        applyToAll: aplicar,
      });
      if (resultado.rule !== null && resultado.retroactive !== null && resultado.retroactive.remaining > 0) {
        setProgresso(resultado.retroactive.remaining);
        await continuarRetroativo(resultado.rule.id, selecionada);
        return;
      }
      concluir(selecionada);
    } catch {
      setErroSalvar(true);
    } finally {
      setSalvando(false);
    }
  }

  const lista = (() => {
    if (falha) {
      return (
        <ErrorState
          title="Não deu para carregar as categorias."
          offline={falha.code === "sem_conexao"}
          onRetry={carregar}
        />
      );
    }
    if (categorias === null) return <SkeletonCard />;
    return (
      <div
        role="radiogroup"
        aria-label="Categorias"
        className="flex min-w-0 flex-col rounded-card bg-card px-2 py-1.5 shadow-card"
      >
        {visivel.map(({ categoria, subcategorias }) => (
          <Fragment key={categoria.id}>
            <LinhaCategoria
              categoria={categoria}
              sub={false}
              marcada={selecionada === categoria.id}
              sugerida={sugerida === categoria.id}
              aoEscolher={setSelecionada}
            />
            {subcategorias.map((sub) => (
              <LinhaCategoria
                key={sub.id}
                categoria={sub}
                sub
                marcada={selecionada === sub.id}
                sugerida={sugerida === sub.id}
                aoEscolher={setSelecionada}
              />
            ))}
            {!buscando && subcategorias.length > 0 && (
              <Link
                to={caminhoNovaCategoria({ pai: categoria.id })}
                className="flex min-h-[44px] items-center gap-2.5 pr-3.5 pl-9 text-[13px] font-semibold text-primary"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Subcategoria em {categoria.name}
              </Link>
            )}
          </Fragment>
        ))}
        {buscando && visivel.length === 0 && (
          <p role="status" className="px-3.5 py-4 text-center text-[14px] text-ink-2">
            Nenhuma categoria encontrada.
          </p>
        )}
      </div>
    );
  })();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <GreenTop variant="form" title="Categoria" close={{ to: destinoDeVoltar(aba), label: "Fechar" }} />

      <div className="grid flex-1 gap-5 px-4 pt-4 pb-6 tablet:grid-cols-2 tablet:px-6 tablet:pt-5 desktop:grid-cols-3 desktop:px-8">
        <div className="flex min-w-0 flex-col gap-3.5 tablet:col-start-1 tablet:row-start-1 desktop:col-start-1 desktop:row-start-1">
          <label className="flex min-h-[52px] items-center gap-2.5 rounded-[18px] bg-card px-4 shadow-card">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
              className="shrink-0 text-ink-2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <span className="sr-only">Buscar categoria</span>
            <input
              type="text"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar categoria"
              autoComplete="off"
              className="min-h-12 min-w-0 flex-1 bg-transparent font-sans text-[15px] text-ink outline-none placeholder:text-hidden-ink"
            />
          </label>

          <Link
            to={caminhoNovaCategoria({})}
            className="flex min-h-14 items-center gap-3 rounded-[18px] border border-dashed border-chip-border px-[18px] text-[15px] font-semibold text-primary-ink"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nova categoria
          </Link>
        </div>

        <div className="min-w-0 tablet:col-start-1 tablet:row-start-2 desktop:col-start-2 desktop:row-start-1">
          {lista}
        </div>

        {transacao !== null && (
          <div className="flex min-w-0 flex-col gap-3 tablet:col-start-1 tablet:row-start-3 desktop:col-start-3 desktop:row-start-1">
            {falhaCategorizacao && (
              <p role="alert" className="rounded-[18px] bg-card px-4 py-3 text-[14px] text-ink shadow-card">
                Não deu para carregar esta compra.
              </p>
            )}
            {erroSalvar && (
              <p role="alert" className="rounded-[18px] bg-card px-4 py-3 text-[14px] text-ink shadow-card">
                Não deu para salvar. Tente de novo.
              </p>
            )}
            {podeAplicarATodas && categorizacao !== null && (
              <section
                aria-label="Aplicar a todas"
                className="flex flex-col gap-3 rounded-[24px] bg-card px-[22px] py-[18px] shadow-card"
              >
                <div className="flex min-h-11 items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[15px] font-semibold text-ink">
                      Aplicar a todas de {categorizacao.matchLabel}
                    </span>
                    <span className="text-[12px] leading-[1.45] text-ink-2">
                      Vale para as compras antigas e as próximas. Vira regra para a IA.
                    </span>
                  </div>
                  <Switch
                    checked={aplicarTodas}
                    onCheckedChange={setAplicarTodas}
                    disabled={salvando}
                    label="Aplicar a todas as compras deste estabelecimento"
                  />
                </div>
                {progresso !== null && falhaRetroativo === null && (
                  <p role="status" className="text-[13px] text-ink-2">
                    Aplicando às compras antigas… faltam {progresso}
                  </p>
                )}
                {falhaRetroativo !== null && (
                  <div className="flex flex-col gap-2.5">
                    <p role="alert" className="text-[13px] font-semibold text-ink">
                      Não deu para aplicar a todas as compras antigas agora.
                    </p>
                    <p className="text-[12px] leading-[1.45] text-ink-2">
                      A regra já vale para as próximas compras.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void continuarRetroativo(falhaRetroativo, selecionada ?? "")}>
                        Tentar de novo
                      </Button>
                      <Button variant="secondary" onClick={() => concluir(selecionada ?? "")}>
                        Deixar para depois
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-divider bg-card px-4 pt-3 pb-7 tablet:flex tablet:justify-end tablet:px-6 tablet:pt-3.5 tablet:pb-[18px]">
        <Button
          full
          disabled={selecionada === null || salvando}
          loading={salvando}
          onClick={() => void salvar()}
          className="tablet:w-[360px]"
        >
          Salvar categoria
        </Button>
      </footer>
    </div>
  );
}
