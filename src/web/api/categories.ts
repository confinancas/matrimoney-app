import type { CategoryDTO } from "../../shared/categories";
import type { SpendType } from "../../shared/spend-types";
import { apiFetch } from "../lib/api";

// Corpo da criação (POST /api/categories). Sem arquivada: a categoria nova nasce ativa.
export type NovaCategoriaEntrada = {
  name: string;
  color: string;
  parentId: string | null;
  aiHint: string | null;
  defaultSpendType: SpendType | null;
};

const JSON_HEADERS = { "content-type": "application/json" };

// Lista do lar; sem o parâmetro, só as ativas.
export async function fetchCategories(opcoes: { incluirArquivadas?: boolean } = {}): Promise<CategoryDTO[]> {
  const consulta = opcoes.incluirArquivadas ? "?incluirArquivadas=1" : "";
  const resposta = await apiFetch<{ categories: CategoryDTO[] }>(`/api/categories${consulta}`);
  return resposta.categories;
}

export async function createCategory(entrada: NovaCategoriaEntrada): Promise<CategoryDTO> {
  const resposta = await apiFetch<{ category: CategoryDTO }>("/api/categories", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(entrada),
  });
  return resposta.category;
}

export async function updateCategory(
  id: string,
  patch: Partial<NovaCategoriaEntrada> & { archived?: boolean },
) {
  const resposta = await apiFetch<{ category: CategoryDTO }>(`/api/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  return resposta.category;
}
