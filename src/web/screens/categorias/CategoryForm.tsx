import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";
import {
  CATEGORY_PALETTE,
  type CategoryDTO,
  type CategoryFieldErrors,
  type CategoryInput,
  validateCategoryInput,
} from "../../../shared/categories";
import type { NovaCategoriaEntrada } from "../../api/categories";

export type ValoresIniciais = {
  name: string;
  color: string;
  parentId: string | null;
  aiHint: string | null;
};

type Props = {
  // Categorias ativas do lar: as principais viram as opções de "Dentro de".
  categorias: CategoryDTO[];
  inicial: ValoresIniciais;
  textoBotao: string;
  enviando: boolean;
  erroGeral?: string | null;
  // Erros que a API devolveu (422), mostrados junto dos campos.
  erroCampos?: CategoryFieldErrors;
  aoEnviar: (entrada: NovaCategoriaEntrada) => void;
};

// Formulário de categoria (criar nesta task; a TASK-0305 reaproveita para editar). A validação é a mesma da API.
export function CategoryForm({
  categorias,
  inicial,
  textoBotao,
  enviando,
  erroGeral,
  erroCampos,
  aoEnviar,
}: Props) {
  const idPai = useId();
  const idDica = useId();
  const [nome, setNome] = useState(inicial.name);
  const [cor, setCor] = useState(inicial.color);
  const [paiId, setPaiId] = useState(inicial.parentId ?? "");
  const [dica, setDica] = useState(inicial.aiHint ?? "");
  const [errosLocais, setErrosLocais] = useState<CategoryFieldErrors>({});

  const erros: CategoryFieldErrors = { ...erroCampos, ...errosLocais };
  const principais = categorias.filter((categoria) => categoria.parentId === null);
  const nomeVisivel = nome.trim() === "" ? "Nova categoria" : nome.trim();

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const entrada: CategoryInput = {
      name: nome,
      color: cor,
      parentId: paiId === "" ? null : paiId,
      aiHint: dica,
      defaultSpendType: null,
      archived: false,
    };
    const validacao = validateCategoryInput(entrada, categorias);
    if (!validacao.ok) {
      setErrosLocais(validacao.fields);
      return;
    }
    setErrosLocais({});
    aoEnviar({
      name: validacao.valor.name,
      color: validacao.valor.color,
      parentId: validacao.valor.parentId,
      aiHint: validacao.valor.aiHint,
      defaultSpendType: validacao.valor.defaultSpendType,
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-1 flex-col">
      <div className="flex flex-col gap-3.5 px-4 pt-4 pb-6 tablet:flex-row tablet:items-start tablet:gap-[18px] tablet:px-6 tablet:pt-5">
        <section className="flex flex-col items-center gap-3 rounded-card bg-card px-[22px] py-[26px] shadow-card tablet:flex-1">
          <span
            aria-hidden="true"
            className="size-14 rounded-[24px]"
            style={{ backgroundColor: cor, boxShadow: `0 0 24px ${cor}` }}
          />
          <span className="max-w-full break-words text-center font-sans text-[22px] font-extrabold text-ink">
            {nomeVisivel}
          </span>
          <span className="text-[12px] text-ink-2">Prévia</span>
        </section>

        <section className="flex flex-col gap-[18px] rounded-card bg-card px-[22px] py-5 shadow-card tablet:flex-1">
          <TextField
            label="Nome"
            placeholder="Ex.: Pet, Academia, Viagem"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            error={erros.name}
            autoComplete="off"
          />

          <div className="flex flex-col gap-2">
            <label htmlFor={idPai} className="text-[13px] text-ink-2">
              Dentro de
            </label>
            <select
              id={idPai}
              value={paiId}
              onChange={(evento) => setPaiId(evento.target.value)}
              aria-invalid={erros.parentId ? true : undefined}
              aria-describedby={`${idPai}-ajuda`}
              className="h-[52px] rounded-field border border-tile-border bg-card px-3.5 font-sans text-[16px] text-ink outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/14"
            >
              <option value="">Nenhuma · é categoria principal</option>
              {principais.map((principal) => (
                <option key={principal.id} value={principal.id}>
                  {principal.name}
                </option>
              ))}
            </select>
            <p id={`${idPai}-ajuda`} className="text-[12px] leading-[1.45] text-ink-2">
              Escolha uma categoria para criar uma subcategoria, como Higienópolis dentro de Mercado. Só um
              nível.
            </p>
            {erros.parentId && <p className="text-[13px] text-danger">{erros.parentId}</p>}
          </div>

          <div role="radiogroup" aria-label="Cor" className="flex flex-col gap-2.5">
            <span className="text-[13px] text-ink-2">Cor</span>
            <div className="grid grid-cols-6 gap-2 tablet:gap-x-1">
              {CATEGORY_PALETTE.map((paleta) => {
                const marcada = paleta.cor === cor;
                return (
                  <label
                    key={paleta.cor}
                    className={cn(
                      "flex h-11 cursor-pointer items-center justify-center rounded-[22px] border-[1.5px] focus-within:ring-[3px] focus-within:ring-primary/30",
                      marcada ? "border-ink" : "border-transparent",
                    )}
                  >
                    <input
                      type="radio"
                      name="cor-da-categoria"
                      value={paleta.cor}
                      checked={marcada}
                      aria-label={paleta.nome}
                      onChange={() => setCor(paleta.cor)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="size-[30px] rounded-full"
                      style={{
                        backgroundColor: paleta.cor,
                        boxShadow: marcada ? `0 0 12px ${paleta.cor}` : undefined,
                      }}
                    />
                  </label>
                );
              })}
            </div>
            {erros.color && <p className="text-[13px] text-danger">{erros.color}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={idDica} className="text-[13px] text-ink-2">
              Dica para a IA (opcional)
            </label>
            <textarea
              id={idDica}
              rows={3}
              value={dica}
              onChange={(evento) => setDica(evento.target.value)}
              placeholder="Ex.: compras na Petz, Cobasi e veterinário"
              aria-invalid={erros.aiHint ? true : undefined}
              aria-describedby={`${idDica}-ajuda`}
              className="resize-none rounded-field border border-field-border bg-field px-4 py-3.5 font-sans text-[15px] leading-[1.45] text-ink outline-none placeholder:text-hidden-ink focus:border-primary focus:ring-[3px] focus:ring-primary/14"
            />
            <p id={`${idDica}-ajuda`} className="text-[12px] leading-[1.45] text-ink-2">
              Entra no documento de regras que a IA usa para categorizar.
            </p>
            {erros.aiHint && <p className="text-[13px] text-danger">{erros.aiHint}</p>}
          </div>
        </section>
      </div>

      <footer className="mt-auto border-t border-divider bg-card px-4 pt-3 pb-7 tablet:flex tablet:justify-end tablet:px-6 tablet:pt-3.5 tablet:pb-[18px]">
        {erros.defaultSpendType && <p className="mb-3 text-[13px] text-danger">{erros.defaultSpendType}</p>}
        {erroGeral && (
          <p role="alert" className="mb-3 text-center text-[13px] text-danger">
            {erroGeral}
          </p>
        )}
        <Button type="submit" full loading={enviando} className="tablet:w-[360px]">
          {textoBotao}
        </Button>
      </footer>
    </form>
  );
}
