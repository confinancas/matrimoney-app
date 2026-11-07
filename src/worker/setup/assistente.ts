// Regras do assistente (TASK-0102), sem efeitos: a disponibilidade vem do código (ASSISTANT_AVAILABLE) e é um parâmetro.
// Função pura, sem o banco: os testes unitários importam daqui.
export function podeLigarAssistente(disponivel: boolean, temChaveDaIa: boolean): boolean {
  return disponivel && temChaveDaIa;
}

export function assistenteAtivo(disponivel: boolean, temChaveDaIa: boolean, ligadoNoBanco: boolean): boolean {
  return disponivel && temChaveDaIa && ligadoNoBanco;
}
