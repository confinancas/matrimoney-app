import type { SetupStatus } from "../../shared/setup";

// Passo em que a configuração inicial começa: 1 código, 2 chave da IA, 3 como começar; "entrar" quando já está pronto.
export type PassoInicial = 1 | 2 | 3 | "entrar";

export function initialSetupStep(status: SetupStatus): PassoInicial {
  if (status.mode === "pronto") return "entrar";
  if (!status.unlocked) return 1;
  if (status.mode === "configuracao") return 2;
  return 3;
}
