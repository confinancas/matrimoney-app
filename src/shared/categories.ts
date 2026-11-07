import { SPEND_TYPES, type SpendType } from "./spend-types";

// Paleta fixa da TASK-0301 (do protótipo NovaCategoria): a API só aceita estas cores.
export const CATEGORY_PALETTE = [
  { nome: "Roxo", cor: "#7C4DFF" },
  { nome: "Lavanda", cor: "#A78BFA" },
  { nome: "Ciano", cor: "#22B8E0" },
  { nome: "Verde", cor: "#22A06B" },
  { nome: "Turquesa", cor: "#13B5A6" },
  { nome: "Laranja", cor: "#F7931E" },
  { nome: "Rosa", cor: "#F0559A" },
  { nome: "Lilás", cor: "#C06BEA" },
  { nome: "Rosa claro", cor: "#F9A8C9" },
  { nome: "Azul", cor: "#1B84F2" },
  { nome: "Areia", cor: "#C4995B" },
  { nome: "Cinza", cor: "#8794A8" },
] as const;

export const CATEGORY_NAME_MAX = 40;
export const CATEGORY_HINT_MAX = 300;

// Forma de uma categoria na API (GET, POST e PATCH). parentId aponta sempre para uma principal do mesmo lar.
export type CategoryDTO = {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  defaultSpendType: SpendType | null;
  aiHint: string | null;
  sort: number;
  archived: boolean;
};

// Campos que o usuário preenche, mais o estado final de arquivada (no PATCH, o estado depois da mudança).
export type CategoryInput = {
  name: string;
  color: string;
  parentId: string | null;
  aiHint: string | null;
  defaultSpendType: string | null;
  archived: boolean;
};

// O que a validação precisa saber de cada categoria do lar (ativa ou arquivada).
export type CategoryRef = {
  id: string;
  name: string;
  parentId: string | null;
  archived: boolean;
};

export type CategoryFieldName = "name" | "color" | "parentId" | "aiHint" | "defaultSpendType" | "archived";
export type CategoryFieldErrors = Partial<Record<CategoryFieldName, string>>;

export type CategoryValidation =
  | { ok: true; valor: Omit<CategoryInput, "defaultSpendType"> & { defaultSpendType: SpendType | null } }
  | { ok: false; fields: CategoryFieldErrors };

// Compara nomes sem acento, sem caixa e sem espaços nas pontas.
export function normalizeForCompare(texto: string): string {
  return texto
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const compararNomes = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x < y) return -1;
  return x > y ? 1 : 0;
};

const porOrdem = (a: CategoryDTO, b: CategoryDTO): number => a.sort - b.sort || compararNomes(a.name, b.name);

// Regras de uma categoria, na API (rota) e no formulário. input é o estado final da categoria.
// idEmEdicao é a categoria que está sendo alterada (vazio na criação); existentes são todas do lar, arquivadas inclusive.
export function validateCategoryInput(
  input: CategoryInput,
  existentes: readonly CategoryRef[],
  idEmEdicao?: string,
): CategoryValidation {
  const fields: CategoryFieldErrors = {};
  const nome = input.name.trim();
  const cor = input.color.trim().toUpperCase();
  const dica = input.aiHint?.trim() ?? "";
  const tipo = input.defaultSpendType?.trim() ?? "";

  if (nome.length === 0) {
    fields.name = "Dê um nome à categoria.";
  } else if (nome.length > CATEGORY_NAME_MAX) {
    fields.name = "Use até 40 caracteres.";
  } else if (!input.archived) {
    const chave = normalizeForCompare(nome);
    const repetida = existentes.some(
      (categoria) =>
        categoria.id !== idEmEdicao && !categoria.archived && normalizeForCompare(categoria.name) === chave,
    );
    if (repetida) fields.name = "Já existe uma categoria com esse nome.";
  }

  const corValida = CATEGORY_PALETTE.some((paleta) => paleta.cor === cor);
  if (!corValida) fields.color = "Escolha uma das cores.";

  const atual =
    idEmEdicao === undefined ? undefined : existentes.find((categoria) => categoria.id === idEmEdicao);
  const mudouPai = atual === undefined || atual.parentId !== input.parentId;
  // Pai só é conferido quando muda ou quando a categoria fica (ou continua) ativa: arquivada sem mudança, não.
  const conferePai = input.parentId !== null && (mudouPai || !input.archived);

  if (input.parentId !== null && conferePai) {
    const pai = existentes.find((categoria) => categoria.id === input.parentId);
    if (!pai || pai.id === idEmEdicao || pai.parentId !== null) {
      fields.parentId = "Escolha uma categoria principal.";
    } else if (pai.archived) {
      if (mudouPai) fields.parentId = "Escolha uma categoria principal.";
      else fields.archived = "Reative antes a categoria principal.";
    }
  }

  if (input.parentId !== null && idEmEdicao !== undefined && fields.parentId === undefined) {
    const temSubcategoriasAtivas = existentes.some(
      (categoria) => categoria.parentId === idEmEdicao && !categoria.archived,
    );
    if (temSubcategoriasAtivas) {
      fields.parentId = "Uma categoria com subcategorias não pode ficar dentro de outra.";
    }
  }

  if (dica.length > CATEGORY_HINT_MAX) fields.aiHint = "Use até 300 caracteres.";

  const tipoValido = tipo === "" || SPEND_TYPES.some((spend) => spend.id === tipo);
  if (!tipoValido) fields.defaultSpendType = "Tipo de gasto inválido.";

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    valor: {
      name: nome,
      color: cor,
      parentId: input.parentId,
      aiHint: dica === "" ? null : dica,
      defaultSpendType: tipo === "" ? null : (tipo as SpendType),
      archived: input.archived,
    },
  };
}

// Ordem da lista: sort, depois nome (sem caixa); cada principal seguida das subcategorias dela.
// Inclui arquivadas quando recebe; as que não têm principal na lista vão para o fim.
export function ordenarCategorias(categorias: readonly CategoryDTO[]): CategoryDTO[] {
  const principais = categorias.filter((categoria) => categoria.parentId === null).sort(porOrdem);
  const idsDePrincipais = new Set(principais.map((categoria) => categoria.id));
  const subcategorias = categorias.filter((categoria) => categoria.parentId !== null);

  const saida: CategoryDTO[] = [];
  for (const principal of principais) {
    saida.push(principal);
    saida.push(...subcategorias.filter((sub) => sub.parentId === principal.id).sort(porOrdem));
  }
  saida.push(...subcategorias.filter((sub) => !idsDePrincipais.has(sub.parentId as string)).sort(porOrdem));
  return saida;
}

export type CategoryNode = { categoria: CategoryDTO; subcategorias: CategoryDTO[] };

// Árvore das categorias ativas: principais em ordem, cada uma com as subcategorias ativas dela.
export function buildCategoryTree(categorias: readonly CategoryDTO[]): CategoryNode[] {
  const ativas = categorias.filter((categoria) => !categoria.archived);
  const principais = ativas.filter((categoria) => categoria.parentId === null).sort(porOrdem);
  return principais.map((principal) => ({
    categoria: principal,
    subcategorias: ativas.filter((sub) => sub.parentId === principal.id).sort(porOrdem),
  }));
}

// Busca da lista: uma principal que casa aparece com todas as subcategorias; senão, aparece
// com as subcategorias que casam (a principal aparece quando uma subcategoria casa).
export function filtrarCategorias(arvore: readonly CategoryNode[], busca: string): CategoryNode[] {
  const termo = normalizeForCompare(busca);
  if (termo === "") return [...arvore];

  const resultado: CategoryNode[] = [];
  for (const { categoria, subcategorias } of arvore) {
    if (normalizeForCompare(categoria.name).includes(termo)) {
      resultado.push({ categoria, subcategorias });
      continue;
    }
    const casam = subcategorias.filter((sub) => normalizeForCompare(sub.name).includes(termo));
    if (casam.length > 0) resultado.push({ categoria, subcategorias: casam });
  }
  return resultado;
}

// Cor sugerida para uma categoria nova: com pai, a cor da principal; senão, a primeira da paleta sem uso
// entre as principais ativas. Todas usadas: Roxo.
export function defaultColorFor(categorias: readonly CategoryDTO[], parentId?: string | null): string {
  if (parentId) {
    const pai = categorias.find((categoria) => categoria.id === parentId);
    if (pai) return pai.color;
  }
  const usadas = new Set(
    categorias
      .filter((categoria) => !categoria.archived && categoria.parentId === null)
      .map((categoria) => categoria.color.toUpperCase()),
  );
  const livre = CATEGORY_PALETTE.find((paleta) => !usadas.has(paleta.cor));
  return (livre ?? CATEGORY_PALETTE[0]).cor;
}
