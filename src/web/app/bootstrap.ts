import type { HealthResponse } from "../../shared/api";
import type { SetupStatus } from "../../shared/setup";
import { apiFetch, CAMINHO_DA_CONFIGURACAO } from "../lib/api";

// Uma verificação da partida: devolve a rota para onde ir, ou null para seguir. Lança se a verificação falhar.
export type StartCheck = () => Promise<string | null>;

async function checkApi(): Promise<string | null> {
  await apiFetch<HealthResponse>("/api/health");
  return null;
}

// Fora de pronto (configuração ou cadastro), a partida vai para a configuração inicial.
async function checkSetup(): Promise<string | null> {
  const estado = await apiFetch<SetupStatus>("/api/setup/status");
  return estado.mode === "pronto" ? null : CAMINHO_DA_CONFIGURACAO;
}

// A TASK-0104 acrescenta a verificação de sessão depois da configuração.
export const START_CHECKS: StartCheck[] = [checkApi, checkSetup];

export async function resolveStartRoute(): Promise<string> {
  for (const verificar of START_CHECKS) {
    const rota = await verificar();
    if (rota !== null) return rota;
  }
  return "/inicio";
}
