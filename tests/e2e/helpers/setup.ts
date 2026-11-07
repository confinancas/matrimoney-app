import { createHash, randomUUID } from "node:crypto";
import { executaSql, PORTA_DA_CONFIGURACAO } from "./db";

// Código de primeiro acesso dos testes: TEST-TEST-TEST, normalizado (é o que o banco guarda o hash de).
const CODIGO_NORMALIZADO = "TESTTESTTEST";
export const CODIGO_DE_TESTE = "TEST-TEST-TEST";
const HASH_DO_CODIGO = createHash("sha256").update(CODIGO_NORMALIZADO).digest("hex");

function insereCodigo(usado: boolean): string {
  const agora = new Date().toISOString();
  const usadoEm = usado ? `'${agora}'` : "NULL";
  return `INSERT INTO invites (id, household_id, kind, token_hash, created_at, used_at) VALUES ('${randomUUID()}', NULL, 'primeiro_acesso', '${HASH_DO_CODIGO}', '${agora}', ${usadoEm})`;
}

// Instalação pronta, sem chaves: o primeiro acesso usado. A instância pronta guarda "pronto" no módulo, então isto
// vale até o fim da execução dos testes (a instância nunca volta à configuração).
export function semearInstalacaoPronta(): void {
  executaSql(
    "pronta",
    ["DELETE FROM app_secrets", "DELETE FROM feature_flags", "DELETE FROM invites", insereCodigo(true)].join(
      "; ",
    ),
  );
}

// Zera as chaves e as flags da instalação pronta; o primeiro acesso continua usado.
export function zeraChavesDaInstalacaoPronta(): void {
  executaSql("pronta", "DELETE FROM app_secrets; DELETE FROM feature_flags");
}

// Cenário 15: a linha da chave da IA existe, mas a chave mestra atual não a abre.
export function gravaChaveQueNaoAbre(): void {
  executaSql(
    "pronta",
    "DELETE FROM app_secrets; INSERT INTO app_secrets (name, ciphertext, iv, updated_at) VALUES ('claude_api_key', 'AAAA', 'AAAA', '2026-11-07T00:00:00.000Z')",
  );
}

// Configuração inicial do zero, na instância de configuração: primeiro acesso aberto, sem chave, sem flag.
export function preparaConfiguracaoDoZero(): void {
  executaSql(
    "configuracao",
    ["DELETE FROM app_secrets", "DELETE FROM feature_flags", "DELETE FROM invites", insereCodigo(false)].join(
      "; ",
    ),
  );
}

// Espera a instância responder (o webServer do Playwright só confere a porta principal).
export async function esperaInstalacao(porta: number, limiteMs = 120_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    try {
      const resposta = await fetch(`http://127.0.0.1:${porta}/api/health`);
      if (resposta.ok) return;
    } catch {
      // ainda não subiu
    }
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  throw new Error(`A instância da porta ${porta} não respondeu a tempo.`);
}

export { PORTA_DA_CONFIGURACAO };
