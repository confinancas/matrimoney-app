import type { SpendType } from "../../shared/spend-types";
import { apiFetch } from "../lib/api";

// Categorização de uma transação e regras (TASK-0302). O cliente manda só o id da transação e a categoria escolhida;
// a chave de casamento sai do servidor.

export type ScopeDaRegra = "estabelecimento" | "destinatario" | "remetente" | null;

export type RegraDaTransacao = {
  id: string;
  createdFrom: string;
  setCategoryId: string | null;
  setCustomName: string | null;
  setSpendType: SpendType | null;
};

export type Categorizacao = {
  transactionId: string;
  scope: ScopeDaRegra;
  matchLabel: string | null;
  categoryId: string | null;
  aiCategoryId: string | null;
  rule: RegraDaTransacao | null;
};

export type ResultadoDaCategoria = {
  transactionId: string;
  categoryId: string;
  rule: { id: string } | null;
  retroactive: { applied: number; remaining: number } | null;
};

export type FatiaRetroativa = { applied: number; remaining: number };

const JSON_HEADERS = { "content-type": "application/json" };

export function fetchCategorization(transacaoId: string): Promise<Categorizacao> {
  return apiFetch<Categorizacao>(`/api/transactions/${encodeURIComponent(transacaoId)}/categorization`);
}

export function saveTransactionCategory(
  transacaoId: string,
  entrada: { categoryId: string; applyToAll: boolean },
): Promise<ResultadoDaCategoria> {
  return apiFetch<ResultadoDaCategoria>(`/api/transactions/${encodeURIComponent(transacaoId)}/category`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(entrada),
  });
}

export function applyRetroactive(regraId: string): Promise<FatiaRetroativa> {
  return apiFetch<FatiaRetroativa>(`/api/rules/${encodeURIComponent(regraId)}/apply-retroactive`, {
    method: "POST",
  });
}
