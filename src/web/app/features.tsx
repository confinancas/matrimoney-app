import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { FeaturesResponse } from "../../shared/setup";
import { apiFetch } from "../lib/api";

// Funções ligadas pela configuração (TASK-0102). O padrão é tudo desligado: é o que vale até a API responder.
export type Features = FeaturesResponse;

export const FEATURES_PADRAO: Features = { ia: false, assistente: false, voz: false };

const Contexto = createContext<Features>(FEATURES_PADRAO);
const AtualizacaoDeFeatures = createContext<() => void>(() => undefined);

// Sem "valores", lê GET /api/features ao montar e a cada useAtualizarFeatures(); se a leitura falha, mantém o último valor.
// Com "valores" (testes e telas de desenvolvimento), não lê nada.
export function FeaturesProvider({ valores, children }: { valores?: Features; children: ReactNode }) {
  const [lidas, setLidas] = useState<Features>(FEATURES_PADRAO);

  // Lê GET /api/features. Se a leitura falha, o último valor fica como está.
  const ler = useCallback(() => {
    apiFetch<Features>("/api/features").then(setLidas, () => {
      // Mantém o último valor: uma falha de leitura não zera o que já se sabia.
    });
  }, []);

  useEffect(() => {
    if (valores) return;
    ler();
  }, [valores, ler]);

  return (
    <AtualizacaoDeFeatures.Provider value={ler}>
      <Contexto.Provider value={valores ?? lidas}>{children}</Contexto.Provider>
    </AtualizacaoDeFeatures.Provider>
  );
}

export function useFeatures(): Features {
  return useContext(Contexto);
}

// Relê GET /api/features (a TASK-0104 chama depois de entrar).
export function useAtualizarFeatures(): () => void {
  return useContext(AtualizacaoDeFeatures);
}
