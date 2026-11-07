import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { chaveVazia, type RuleScope, type RuleSet, ruleScopeForMovement } from "../../shared/rule-match";
import { SPEND_TYPES } from "../../shared/spend-types";
import {
  applyRuleRetroactiveSliceStmts,
  applyRuleToPendingStmt,
  type RegraParaAplicar,
  setTransactionCategoryStmt,
} from "../categorization/apply";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  disableRuleStmt,
  getRuleContextForTransaction,
  lerRegraPorId,
  type TransacaoDoContexto,
  upsertRuleStmts,
} from "./repo";
import { runRetroactiveSlice } from "./retroactive";

// Rotas de categorização por transação e de regras (TASK-0302). Sessão obrigatória: o lar vem do resolvedor, e tudo
// é filtrado pelo lar da sessão (404 para o que é de outro lar). Montadas em /api/transactions e /api/rules.

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");
const validacao = (c: Context<AppEnv>, fields: Record<string, string>) =>
  apiError(c, 422, "validacao", undefined, { fields });

async function lerCorpo<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  const lido = schema.safeParse(corpo);
  return lido.success ? lido.data : undefined;
}

const corpoDaCategoria = z.strictObject({ categoryId: z.string().min(1), applyToAll: z.boolean() });

const corpoDaRegra = z.strictObject({
  transactionId: z.string().min(1),
  set: z
    .strictObject({
      categoryId: z.string().min(1).optional(),
      spendType: z.string().optional(),
      customName: z.string().optional(),
    })
    .default({}),
  createdFrom: z.enum(["lembrar", "aplicar_todas"]),
});

const SEM_EFEITO: RuleSet = {
  setCustomName: null,
  setCategoryId: null,
  setSpendType: null,
  setIncomeKind: null,
  setIncomeSubtype: null,
  setFixedIncomeId: null,
  setMovement: null,
};

// Chave e escopo de uma transação: o escopo sai do movimento; a chave é a do escopo (sem chave, sem regra).
const chaveDaTransacao = (transacao: TransacaoDoContexto, escopo: RuleScope | null): string | null => {
  if (escopo === "estabelecimento") return transacao.establishmentKey;
  if (escopo === "destinatario" || escopo === "remetente") return transacao.counterpartyKey;
  return null;
};

// Texto que o seletor mostra: o estabelecimento (descrição sem espaços) ou o nome do destinatário.
const rotuloDaTransacao = (transacao: TransacaoDoContexto, escopo: RuleScope | null): string | null => {
  if (escopo === "estabelecimento") return transacao.establishmentKey === null ? null : transacao.descricao;
  if (escopo === null) return null;
  return transacao.counterpartyName?.trim() || null;
};

const somaAplicadas = (resultados: readonly D1Result<unknown>[]): number =>
  resultados.reduce((total, resultado) => total + (resultado.meta?.changes ?? 0), 0);

export function transacoesRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Contexto da seleção: escopo, rótulo, categorias escolhida e sugerida, e a regra do alvo, se houver.
  rotas.get("/:id/categorization", async (c) => {
    const { householdId } = getSession(c);
    const contexto = await getRuleContextForTransaction(c.var.db, householdId, c.req.param("id"), null);
    const transacao = contexto.transacao;
    if (!transacao) return apiError(c, 404, "nao_encontrada");

    const escopo = ruleScopeForMovement(transacao.movement);
    const regra =
      escopo === "estabelecimento"
        ? contexto.regraEstabelecimento
        : escopo === "destinatario"
          ? contexto.regraDestinatario
          : null;
    return c.json(
      {
        transactionId: transacao.id,
        scope: escopo,
        matchLabel: rotuloDaTransacao(transacao, escopo),
        categoryId: transacao.categoryId,
        aiCategoryId: transacao.aiCategoryId,
        rule: regra
          ? {
              id: regra.id,
              createdFrom: regra.createdFrom,
              setCategoryId: regra.setCategoryId,
              setCustomName: regra.setCustomName,
              setSpendType: regra.setSpendType,
            }
          : null,
      },
      200,
    );
  });

  // Grava a categoria da transação. Com applyToAll (só compras), cria ou mescla a regra do estabelecimento e aplica a
  // primeira fatia do retroativo, tudo num lote. A chave vem do servidor, nunca do corpo.
  rotas.put("/:id/category", async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c, corpoDaCategoria);
    if (!corpo) return dadosInvalidos(c);
    const id = c.req.param("id");
    const db = c.var.db;

    const contexto = await getRuleContextForTransaction(db, householdId, id, corpo.categoryId);
    const transacao = contexto.transacao;
    if (!transacao) return apiError(c, 404, "nao_encontrada");

    const escopo = ruleScopeForMovement(transacao.movement);
    const campos: Record<string, string> = {};
    if (!contexto.categoriaExiste || contexto.categoriaAtiva !== true) {
      campos.categoryId = "Categoria inválida.";
    }
    if (corpo.applyToAll) {
      if (escopo !== "estabelecimento") {
        campos.applyToAll = "'Aplicar a todas' só vale para compras.";
      } else if (chaveVazia(transacao.establishmentKey)) {
        campos.applyToAll = "Esta compra não tem estabelecimento para aplicar a todas.";
      }
    }
    if (Object.keys(campos).length > 0) return validacao(c, campos);

    const now = agora().toISOString();
    if (!corpo.applyToAll) {
      await db.$client.batch([
        setTransactionCategoryStmt(db, {
          householdId,
          transactionId: id,
          categoryId: corpo.categoryId,
          by: memberId,
          ruleId: null,
          now,
        }),
      ]);
      return c.json({ transactionId: id, categoryId: corpo.categoryId, rule: null, retroactive: null }, 200);
    }

    const chave = transacao.establishmentKey ?? "";
    const up = upsertRuleStmts(db, {
      householdId,
      scope: "estabelecimento",
      matchValue: chave,
      ativa: contexto.regraEstabelecimento,
      nova: { ...SEM_EFEITO, setCategoryId: corpo.categoryId },
      createdFrom: "aplicar_todas",
      createdBy: memberId,
      now,
    });
    const regra: RegraParaAplicar = {
      id: up.id,
      scope: "estabelecimento",
      matchValue: chave,
      setCustomName: up.mesclada.setCustomName,
      setCategoryId: up.mesclada.setCategoryId,
      setSpendType: up.mesclada.setSpendType,
      setMovement: up.mesclada.setMovement,
    };
    const fatia = applyRuleRetroactiveSliceStmts(db, {
      householdId,
      rule: regra,
      excludeTransactionId: id,
      now,
    });
    const resultados = await db.$client.batch([
      setTransactionCategoryStmt(db, {
        householdId,
        transactionId: id,
        categoryId: corpo.categoryId,
        by: memberId,
        ruleId: up.id,
        now,
      }),
      ...up.comandos,
      ...fatia,
    ]);
    const retroativo = resultados.slice(-fatia.length);
    const contagem = retroativo[retroativo.length - 1]?.results?.[0] as { restantes: number } | undefined;
    return c.json(
      {
        transactionId: id,
        categoryId: corpo.categoryId,
        rule: { id: up.id },
        retroactive: {
          applied: somaAplicadas(retroativo.slice(0, -1)),
          remaining: contagem?.restantes ?? 0,
        },
      },
      200,
    );
  });

  return rotas;
}

export function regrasRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Cria a regra do estabelecimento (compra) ou do destinatário (Pix e TED enviados). "Lembrar" resolve os iguais que
  // esperavam (sem a transação de origem); "Aplicar a todas" faz a primeira fatia do retroativo. Chave do servidor.
  rotas.post("/", async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c, corpoDaRegra);
    if (!corpo) return dadosInvalidos(c);
    const db = c.var.db;
    const { set, createdFrom, transactionId } = corpo;

    const contexto = await getRuleContextForTransaction(
      db,
      householdId,
      transactionId,
      set.categoryId ?? null,
    );
    const transacao = contexto.transacao;
    if (!transacao) return apiError(c, 404, "nao_encontrada");

    const escopo = ruleScopeForMovement(transacao.movement);
    const campos: Record<string, string> = {};
    if (escopo !== "estabelecimento" && escopo !== "destinatario") {
      campos.transactionId = "Esta transação não pode virar regra.";
    }
    const chave = chaveDaTransacao(transacao, escopo) ?? "";
    if (!campos.transactionId && chaveVazia(chave)) {
      campos.transactionId = "Esta transação não tem estabelecimento nem contraparte para lembrar.";
    }
    const nome = set.customName?.trim() || null;
    if (set.categoryId === undefined && set.spendType === undefined && nome === null) {
      campos.set = "Escolha uma categoria, um tipo ou um nome.";
    }
    if (set.categoryId !== undefined && (!contexto.categoriaExiste || contexto.categoriaAtiva !== true)) {
      campos.categoryId = "Categoria inválida.";
    }
    if (set.spendType !== undefined) {
      if (!SPEND_TYPES.some((tipo) => tipo.id === set.spendType)) {
        campos.spendType = "Tipo de gasto inválido.";
      } else if (
        escopo === "estabelecimento" &&
        (set.spendType === "metas" || set.spendType === "investimentos")
      ) {
        campos.spendType = "Compra no cartão nunca é Metas nem Investimentos.";
      }
    }
    if (createdFrom === "aplicar_todas") {
      if (escopo !== "estabelecimento") campos.createdFrom = "'Aplicar a todas' só vale para compras.";
      if (set.categoryId === undefined) campos.categoryId ??= "Escolha uma categoria para aplicar a todas.";
    }
    if (Object.keys(campos).length > 0 || escopo === null) return validacao(c, campos);

    const ativa = escopo === "estabelecimento" ? contexto.regraEstabelecimento : contexto.regraDestinatario;
    const now = agora().toISOString();
    const up = upsertRuleStmts(db, {
      householdId,
      scope: escopo,
      matchValue: chave,
      ativa,
      nova: {
        ...SEM_EFEITO,
        setCustomName: nome,
        setCategoryId: set.categoryId ?? null,
        setSpendType: set.spendType ?? null,
      },
      createdFrom,
      createdBy: memberId,
      now,
    });
    // A categoria herdada da ativa só grava se ainda estiver ativa; a nova já foi validada acima.
    const categoriaAtiva =
      up.mesclada.setCategoryId !== null && (set.categoryId !== undefined || ativa?.categoriaAtiva === true);
    const regra: RegraParaAplicar = {
      id: up.id,
      scope: escopo,
      matchValue: chave,
      setCustomName: up.mesclada.setCustomName,
      setCategoryId: categoriaAtiva ? up.mesclada.setCategoryId : null,
      setSpendType: up.mesclada.setSpendType,
      setMovement: up.mesclada.setMovement,
    };

    const comandos: D1PreparedStatement[] = [...up.comandos];
    const fatia =
      createdFrom === "aplicar_todas"
        ? applyRuleRetroactiveSliceStmts(db, { householdId, rule: regra, excludeTransactionId: null, now })
        : [];
    comandos.push(...fatia);
    const pendentes =
      createdFrom === "lembrar"
        ? applyRuleToPendingStmt(db, { householdId, rule: regra, excludeTransactionId: transactionId, now })
        : null;
    const indicePendentes = pendentes === null ? -1 : comandos.length;
    if (pendentes !== null) comandos.push(pendentes);

    const resultados = await db.$client.batch(comandos);
    const retroativo = fatia.length > 0 ? resultados.slice(up.comandos.length) : [];
    const contagem = retroativo[retroativo.length - 1]?.results?.[0] as { restantes: number } | undefined;
    const alsoResolved =
      indicePendentes >= 0
        ? (resultados[indicePendentes]?.results ?? []).map((linha) => (linha as { id: string }).id)
        : [];
    return c.json(
      {
        rule: { id: up.id, scope: escopo, createdFrom },
        retroactive:
          fatia.length > 0
            ? { applied: somaAplicadas(retroativo.slice(0, -1)), remaining: contagem?.restantes ?? 0 }
            : null,
        alsoResolved,
      },
      201,
    );
  });

  // Uma fatia do "Aplicar a todas": até 2.000 linhas por requisição. 409 quando a regra já foi desativada.
  rotas.post("/:id/apply-retroactive", async (c) => {
    const { householdId } = getSession(c);
    const resultado = await runRetroactiveSlice(
      c.var.db,
      householdId,
      c.req.param("id"),
      agora().toISOString(),
    );
    if (!resultado.ok) {
      if (resultado.motivo === "regra_inativa") return apiError(c, 409, "regra_inativa");
      return apiError(c, 404, "nao_encontrada");
    }
    return c.json({ applied: resultado.applied, remaining: resultado.remaining }, 200);
  });

  // Desativa a regra (DELETE): as transações ficam como estão. Regra de outro lar: 404.
  rotas.delete("/:id", async (c) => {
    const { householdId } = getSession(c);
    const id = c.req.param("id");
    const regra = await lerRegraPorId(c.var.db, householdId, id);
    if (regra === null) return apiError(c, 404, "nao_encontrada");
    await c.var.db.$client.batch([disableRuleStmt(c.var.db, householdId, id, agora().toISOString())]);
    return c.body(null, 204);
  });

  return rotas;
}
