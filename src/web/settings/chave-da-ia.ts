// Regras da chave da IA que a tela mostra antes de enviar (a validação de verdade é do servidor).
const PREFIXO_DA_CHAVE_DE_API = "sk-ant-api";
const PREFIXO_DA_ANTHROPIC = "sk-ant-";

// Aviso (não bloqueia): a chave de outro tipo começa com sk-ant- mas não com sk-ant-api.
export function avisoDeTipoDaChave(chave: string): string | null {
  const limpa = chave.trim();
  if (limpa.startsWith(PREFIXO_DA_ANTHROPIC) && !limpa.startsWith(PREFIXO_DA_CHAVE_DE_API)) {
    return "Essa chave parece ser de outro tipo. A chave da API começa com sk-ant-api.";
  }
  return null;
}
