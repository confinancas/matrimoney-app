// Conta os parâmetros de cada comando que passa pelo D1 (o limite é de 100 por comando). Não mexe no comando: só lê o
// SQL no prepare, e o número de "?" é o de parâmetros que o comando recebe (todos os nossos são posicionais).
export function espiaDeParametros(d1: D1Database): { env: D1Database; maiorComando: () => number } {
  let maior = 0;
  const espiado = {
    prepare: (sql: string) => {
      const total = (sql.match(/\?/g) ?? []).length;
      if (total > maior) maior = total;
      return d1.prepare(sql);
    },
    batch: (comandos: D1PreparedStatement[]) => d1.batch(comandos),
    exec: (sql: string) => d1.exec(sql),
    dump: () => d1.dump(),
    withSession: (restricao?: string) => d1.withSession(restricao),
  };
  return { env: espiado as unknown as D1Database, maiorComando: () => maior };
}
