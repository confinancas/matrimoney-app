import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { CategoryFieldErrors, CategoryInput } from "../../shared/categories";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { type CategoryPatch, createCategory, listCategories, updateCategory } from "./repo";

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");

const validacao = (c: Context<AppEnv>, fields: CategoryFieldErrors) =>
  apiError(c, 422, "validacao", undefined, { fields });

// Corpo da criação: name e color são obrigatórios; o resto é opcional (nulo quando não vem).
const criacaoSchema = z.strictObject({
  name: z.string(),
  color: z.string(),
  parentId: z.string().nullable().optional(),
  aiHint: z.string().nullable().optional(),
  defaultSpendType: z.string().nullable().optional(),
});

// Corpo da alteração: qualquer subconjunto dos campos. Os que não vêm continuam como estão.
const patchSchema = z.strictObject({
  name: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
  aiHint: z.string().nullable().optional(),
  defaultSpendType: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

// Lê o corpo como objeto JSON; undefined quando não é um objeto.
async function lerObjeto(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return undefined;
  return corpo as Record<string, unknown>;
}

export function categoriesRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const incluirArquivadas = c.req.query("incluirArquivadas") === "1";
    const categorias = await listCategories(c.var.db, householdId, { includeArchived: incluirArquivadas });
    return c.json({ categories: categorias }, 200);
  });

  rotas.post("/", async (c) => {
    const { householdId } = getSession(c);
    const corpo = await lerObjeto(c);
    if (corpo === undefined) return dadosInvalidos(c);
    const lido = criacaoSchema.safeParse(corpo);
    if (!lido.success) return dadosInvalidos(c);

    const entrada: CategoryInput = {
      name: lido.data.name,
      color: lido.data.color,
      parentId: lido.data.parentId ?? null,
      aiHint: lido.data.aiHint ?? null,
      defaultSpendType: lido.data.defaultSpendType ?? null,
      archived: false,
    };
    const resultado = await createCategory(c.var.db, householdId, entrada);
    if (!resultado.ok) return validacao(c, resultado.fields);
    return c.json({ category: resultado.category }, 201);
  });

  rotas.patch("/:id", async (c) => {
    const { householdId } = getSession(c);
    const corpo = await lerObjeto(c);
    if (corpo === undefined) return dadosInvalidos(c);
    if (Object.keys(corpo).length === 0) return apiError(c, 400, "nada_para_salvar", "Nada para salvar.");
    const lido = patchSchema.safeParse(corpo);
    if (!lido.success) return dadosInvalidos(c);

    const patch: CategoryPatch = lido.data;
    const resultado = await updateCategory(c.var.db, householdId, c.req.param("id"), patch, agora());
    if (resultado === null) return apiError(c, 404, "nao_encontrada");
    if (!resultado.ok) return validacao(c, resultado.fields);
    return c.json({ category: resultado.category }, 200);
  });

  return rotas;
}
