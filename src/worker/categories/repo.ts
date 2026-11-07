import { asc, eq, sql } from "drizzle-orm";
import {
  type CategoryDTO,
  type CategoryFieldErrors,
  type CategoryInput,
  type CategoryRef,
  ordenarCategorias,
  validateCategoryInput,
} from "../../shared/categories";
import type { SpendType } from "../../shared/spend-types";
import type { Db } from "../db/client";
import { categories } from "../db/schema";
import { ensureCategorySeed, seedRefs, seedStatements } from "./seed";

type CategoryRow = typeof categories.$inferSelect;

export type CategoryPatch = Partial<Omit<CategoryInput, "archived">> & { archived?: boolean };

export type CreateCategoryResult =
  | { ok: true; category: CategoryDTO }
  | { ok: false; fields: CategoryFieldErrors };
export type UpdateCategoryResult =
  | { ok: true; category: CategoryDTO }
  | { ok: false; fields: CategoryFieldErrors }
  | null;

const paraDto = (linha: CategoryRow): CategoryDTO => ({
  id: linha.id,
  name: linha.name,
  color: linha.color,
  parentId: linha.parentId,
  defaultSpendType: linha.defaultSpendType as SpendType | null,
  aiHint: linha.aiHint,
  sort: linha.sort,
  archived: linha.archivedAt !== null,
});

const paraRef = (linha: CategoryRow): CategoryRef => ({
  id: linha.id,
  name: linha.name,
  parentId: linha.parentId,
  archived: linha.archivedAt !== null,
});

// Todas as categorias do lar, arquivadas inclusive (a contagem da semente e a validação usam todas).
const lerCategorias = (db: Db, householdId: string) =>
  db
    .select()
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(categories.sort), sql`${categories.name} COLLATE NOCASE`);

// Lista do lar. Um lar sem nenhuma linha recebe a semente (3 consultas na primeira vez, 1 depois).
export async function listCategories(
  db: Db,
  householdId: string,
  opcoes: { includeArchived: boolean },
): Promise<CategoryDTO[]> {
  let linhas = await lerCategorias(db, householdId);
  if (linhas.length === 0) {
    await ensureCategorySeed(db, householdId);
    linhas = await lerCategorias(db, householdId);
  }
  const todas = linhas.map(paraDto);
  return ordenarCategorias(opcoes.includeArchived ? todas : todas.filter((categoria) => !categoria.archived));
}

// Criação: uma leitura e um db.batch(). Num lar sem categorias, a semente entra no mesmo batch, antes da nova.
export async function createCategory(
  db: Db,
  householdId: string,
  entrada: CategoryInput,
): Promise<CreateCategoryResult> {
  const linhas = await lerCategorias(db, householdId);
  const semLinhas = linhas.length === 0;
  const existentes = semLinhas ? seedRefs(householdId) : linhas.map(paraRef);

  const validacao = validateCategoryInput(entrada, existentes);
  if (!validacao.ok) return { ok: false, fields: validacao.fields };

  const { valor } = validacao;
  const id = crypto.randomUUID();
  const insercao = db.$client
    .prepare(
      "INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)",
    )
    .bind(id, householdId, valor.name, valor.color, valor.parentId, valor.defaultSpendType, valor.aiHint);
  await db.$client.batch([...(semLinhas ? seedStatements(db, householdId) : []), insercao]);

  return {
    ok: true,
    category: {
      id,
      name: valor.name,
      color: valor.color,
      parentId: valor.parentId,
      defaultSpendType: valor.defaultSpendType,
      aiHint: valor.aiHint,
      sort: 0,
      archived: false,
    },
  };
}

// Alteração parcial: o estado final (o que veio mais o que já estava) é validado. Arquivar uma principal
// arquiva as subcategorias ativas no mesmo db.batch(). Categoria de outro lar ou inexistente devolve null (404).
export async function updateCategory(
  db: Db,
  householdId: string,
  id: string,
  patch: CategoryPatch,
  agora: Date,
): Promise<UpdateCategoryResult> {
  const linhas = await lerCategorias(db, householdId);
  const atual = linhas.find((linha) => linha.id === id);
  if (!atual) return null;

  const estadoFinal: CategoryInput = {
    name: patch.name ?? atual.name,
    color: patch.color ?? atual.color,
    parentId: patch.parentId !== undefined ? patch.parentId : atual.parentId,
    aiHint: patch.aiHint !== undefined ? patch.aiHint : atual.aiHint,
    defaultSpendType: patch.defaultSpendType !== undefined ? patch.defaultSpendType : atual.defaultSpendType,
    archived: patch.archived ?? atual.archivedAt !== null,
  };

  const validacao = validateCategoryInput(estadoFinal, linhas.map(paraRef), id);
  if (!validacao.ok) return { ok: false, fields: validacao.fields };

  const { valor } = validacao;
  const agoraIso = agora.toISOString();
  const arquivadaEm = valor.archived ? (atual.archivedAt ?? agoraIso) : null;

  const d1 = db.$client;
  const comandos: D1PreparedStatement[] = [
    d1
      .prepare(
        "UPDATE categories SET name = ?, color = ?, parent_id = ?, ai_hint = ?, default_spend_type = ?, archived_at = ? WHERE id = ? AND household_id = ?",
      )
      .bind(
        valor.name,
        valor.color,
        valor.parentId,
        valor.aiHint,
        valor.defaultSpendType,
        arquivadaEm,
        id,
        householdId,
      ),
  ];
  if (valor.archived && valor.parentId === null) {
    comandos.push(
      d1
        .prepare(
          "UPDATE categories SET archived_at = ? WHERE household_id = ? AND parent_id = ? AND archived_at IS NULL",
        )
        .bind(agoraIso, householdId, id),
    );
  }
  await d1.batch(comandos);

  return {
    ok: true,
    category: {
      id,
      name: valor.name,
      color: valor.color,
      parentId: valor.parentId,
      defaultSpendType: valor.defaultSpendType,
      aiHint: valor.aiHint,
      sort: atual.sort,
      archived: valor.archived,
    },
  };
}
