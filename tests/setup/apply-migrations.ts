import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { resetSetupCacheForTests } from "../../src/worker/setup/state";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Esta versão do pacote não isola o armazenamento por teste: antes de cada teste, esvazia as tabelas de dados
// (o esquema e o d1_migrations ficam). O D1 aplica chaves estrangeiras, então a ordem é a dos filhos antes dos pais.
async function ordemDeEsvaziamento(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).all<{ name: string }>();
  const pendentes = new Map<string, string[]>();
  for (const { name } of results) {
    const chaves = await env.DB.prepare(`PRAGMA foreign_key_list("${name}")`).all<{ table: string }>();
    pendentes.set(
      name,
      chaves.results.map((chave) => chave.table).filter((pai) => pai !== name),
    );
  }
  const ordem: string[] = [];
  while (pendentes.size > 0) {
    const referenciadas = new Set([...pendentes.values()].flat());
    // Sai primeiro quem nenhuma tabela pendente referencia; num ciclo, sai o resto de uma vez.
    const saem = [...pendentes.keys()].filter((nome) => !referenciadas.has(nome));
    const lote = saem.length > 0 ? saem : [...pendentes.keys()];
    for (const nome of lote) {
      ordem.push(nome);
      pendentes.delete(nome);
    }
  }
  return ordem;
}

beforeEach(async () => {
  // O portão guarda "pronto" no módulo: cada teste começa sem esse cache.
  resetSetupCacheForTests();
  const tabelas = await ordemDeEsvaziamento();
  if (tabelas.length > 0) {
    await env.DB.batch(tabelas.map((nome) => env.DB.prepare(`DELETE FROM "${nome}"`)));
  }
});
