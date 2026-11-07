// Máscara da chave para as telas (TASK-0102): nunca a chave inteira. Função pura, sem o banco.
// Com 16 caracteres ou mais: os 7 primeiros, …, os 4 últimos (sk-ant-…x7Fq). Menos que isso: …, os 2 últimos.
export function maskKey(chave: string): string {
  if (chave.length >= 16) return `${chave.slice(0, 7)}…${chave.slice(-4)}`;
  return `…${chave.slice(-2)}`;
}
