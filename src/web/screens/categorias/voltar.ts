// Caminho de volta vindo da URL (?voltar=). Só vale dentro do app: começa com "/", e não com "//" nem com "/\"
// (que o navegador lê como "//", outro site). Qualquer outra coisa é ignorada.
export function caminhoSeguro(valor: string | null): string | null {
  if (valor === null) return null;
  if (!valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) return null;
  const base = "http://app.invalid";
  try {
    if (new URL(valor, base).origin !== base) return null;
  } catch {
    return null;
  }
  return valor;
}
