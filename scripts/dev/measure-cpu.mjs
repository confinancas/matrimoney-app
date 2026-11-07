#!/usr/bin/env node
// Mede a CPU das rotas no Worker de dev compartilhado (matrimoney-dev), só para medir: sem cron e só dados [TEST].
// Uso: npm run cpu -- tests/cpu/TASK-NNXX.json
// A URL do Worker e os valores do .env nunca vão para arquivo nem para a saída: qualquer texto impresso passa por mascara().
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as lerJsonc } from "jsonc-parser";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pastaDasTravas = resolve(raiz, "..", ".locks");
const caminhoDaTrava = join(pastaDasTravas, "cloudflare-dev.lock");
const WORKER = "matrimoney-dev";
const BANCO = "matrimoney-dev-db";
const LIMITE_MS = 10;
const AQUECIMENTO = 2;
const MEDIDAS = 10;
const ESPERA_ANTES_DAS_REQUISICOES_MS = 5000;
const ESPERA_DEPOIS_DAS_REQUISICOES_MS = 10000;
// Uma requisição por segundo: em rajada o tail do Cloudflare perde eventos (medido na TASK-0003: 13 de 24 perdidos).
const INTERVALO_ENTRE_REQUISICOES_MS = 1000;
const wranglerJs = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");
const viteJs = join(raiz, "node_modules", "vite", "bin", "vite.js");

const valoresSecretos = [];
let travaCriada = false;
let tailFilho = null;

class Falha extends Error {}
const falha = (mensagem) => {
  throw new Falha(mensagem);
};

function mascara(texto) {
  let saida = String(texto).replace(/https:\/\/[^\s"'<>]*\.workers\.dev/g, "<url-mascarada>");
  for (const valor of valoresSecretos) saida = saida.split(valor).join("<valor-mascarado>");
  return saida;
}

function lerEnv() {
  const ausente = () => falha("Copie o .env da pasta principal para o worktree.");
  const caminho = join(raiz, ".env");
  if (!existsSync(caminho)) ausente();
  const valores = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const casa = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (casa) valores[casa[1]] = casa[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const necessarias = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "MM_DEV_D1_ID", "MM_DEV_MASTER_KEY"];
  if (necessarias.some((chave) => !valores[chave])) ausente();
  for (const chave of necessarias) valoresSecretos.push(valores[chave]);
  return valores;
}

// Ambiente só do processo filho: o token do .env vale aqui e não muda o login da máquina.
function ambienteDoWrangler(env) {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    WRANGLER_SEND_METRICS: "false",
  };
}

// Igual ao executa, mas a entrada vai pelo stdin: o valor de um segredo nunca entra em argumento.
function executaComEntrada(args, ambiente, entrada) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, args, {
      cwd: raiz,
      env: ambiente,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.stderr.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.on("error", rejeitar);
    filho.on("close", (codigo) => resolver({ codigo, saida }));
    filho.stdin.end(entrada);
  });
}

// Nomes dos segredos do Worker, a partir da saída JSON do wrangler secret list.
function nomesDeSegredos(saida) {
  const inicio = saida.indexOf("[");
  const fim = saida.lastIndexOf("]");
  try {
    return JSON.parse(saida.slice(inicio, fim + 1)).map((segredo) => segredo.name);
  } catch {
    falha("Não consegui ler a lista de segredos do Worker de medição.");
  }
  return [];
}

function executa(args, ambiente) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, args, {
      cwd: raiz,
      env: ambiente,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.stderr.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.on("error", rejeitar);
    filho.on("close", (codigo) => resolver({ codigo, saida }));
  });
}

function confereConta(env) {
  return executa([wranglerJs, "whoami"], ambienteDoWrangler(env)).then(({ codigo, saida }) => {
    if (codigo !== 0) falha(`wrangler whoami falhou; nada foi publicado.\n${mascara(saida)}`);
    if (!saida.includes(env.CLOUDFLARE_ACCOUNT_ID)) {
      falha("A conta do wrangler whoami não é a da conta do .env; nada foi publicado.");
    }
  });
}

function pegaTrava(task) {
  mkdirSync(pastaDasTravas, { recursive: true });
  let descritor;
  try {
    descritor = openSync(caminhoDaTrava, "wx");
  } catch (erro) {
    if (erro.code !== "EEXIST") throw erro;
    let quem = "(conteúdo ilegível)";
    try {
      quem = readFileSync(caminhoDaTrava, "utf8");
    } catch {
      // mantém a mensagem genérica
    }
    falha(
      `Trava ocupada (${caminhoDaTrava}):\n${mascara(quem)}\nAbortado sem deploy. Não apague a trava de outro processo; se o processo morreu, avise o Opus.`,
    );
  }
  writeFileSync(
    descritor,
    `${JSON.stringify({ task, pid: process.pid, inicio: new Date().toISOString() }, null, 2)}\n`,
  );
  closeSync(descritor);
  travaCriada = true;
}

function soltaTrava() {
  if (!travaCriada) return;
  rmSync(caminhoDaTrava, { force: true });
  travaCriada = false;
}

function geraConfigDeDev(env) {
  const base = lerJsonc(readFileSync(join(raiz, "wrangler.jsonc"), "utf8"));
  const config = {
    ...base,
    name: WORKER,
    main: join(raiz, "src", "worker", "index.ts"),
    assets: { ...base.assets, directory: join(raiz, "dist", "client") },
    d1_databases: base.d1_databases.map((banco) => ({
      ...banco,
      database_name: BANCO,
      database_id: env.MM_DEV_D1_ID,
      migrations_dir: join(raiz, "migrations"),
    })),
  };
  delete config.triggers;
  delete config.$schema;
  const pasta = join(raiz, ".wrangler", "cpu");
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, "wrangler.dev.json");
  writeFileSync(arquivo, `${JSON.stringify(config, null, 2)}\n`);
  return arquivo;
}

// Lê objetos JSON concatenados (um por evento, com ou sem quebra de linha), sem depender do formato da linha.
function eventosDoTail(texto) {
  const objetos = [];
  let profundidade = 0;
  let emTexto = false;
  let escapado = false;
  let inicio = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escapado) escapado = false;
      else if (c === "\\") escapado = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === "{") {
      if (profundidade === 0) inicio = i;
      profundidade++;
    } else if (c === "}") {
      profundidade--;
      if (profundidade === 0 && inicio >= 0) {
        try {
          objetos.push(JSON.parse(texto.slice(inicio, i + 1)));
        } catch {
          // um evento ilegível vira "faltou evento" na contagem
        }
        inicio = -1;
      }
    }
  }
  return objetos;
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

const mediana = (valores) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
};

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) falha("Uso: npm run cpu -- tests/cpu/TASK-NNXX.json");
  const pedido = JSON.parse(readFileSync(resolve(raiz, arquivo), "utf8"));
  if (typeof pedido.task !== "string" || !Array.isArray(pedido.requests) || pedido.requests.length === 0) {
    falha('Arquivo de medição inválido: precisa de "task" e de "requests".');
  }
  if (
    pedido.setupSql !== undefined &&
    !(Array.isArray(pedido.setupSql) && pedido.setupSql.every((sql) => typeof sql === "string"))
  ) {
    falha('Arquivo de medição inválido: "setupSql" é uma lista de comandos SQL.');
  }

  const env = lerEnv();
  await confereConta(env);
  pegaTrava(pedido.task);

  try {
    const cfg = geraConfigDeDev(env);
    const build = await executa([viteJs, "build"], process.env);
    if (build.codigo !== 0) falha(`vite build falhou.\n${mascara(build.saida)}`);

    const deploy = await executa([wranglerJs, "deploy", "-c", cfg], ambienteDoWrangler(env));
    if (deploy.codigo !== 0) falha(`wrangler deploy falhou.\n${mascara(deploy.saida)}`);
    const casa = /https:\/\/matrimoney-dev\.[^\s"'<>]+\.workers\.dev/.exec(deploy.saida);
    if (!casa) falha("A saída do deploy não trouxe a URL do Worker.");
    const urlDoWorker = casa[0];
    console.log("Deploy ok (URL mascarada nesta saída).");

    // Chave mestra do Worker de medição: gravada só se faltar, nunca trocada (cifra as chaves de teste).
    const segredos = await executa(
      [wranglerJs, "secret", "list", "-c", cfg, "--format", "json"],
      ambienteDoWrangler(env),
    );
    if (segredos.codigo !== 0) falha(`wrangler secret list falhou.\n${mascara(segredos.saida)}`);
    if (!nomesDeSegredos(segredos.saida).includes("MASTER_KEY")) {
      const gravacao = await executaComEntrada(
        [wranglerJs, "secret", "put", "MASTER_KEY", "-c", cfg],
        ambienteDoWrangler(env),
        env.MM_DEV_MASTER_KEY,
      );
      if (gravacao.codigo !== 0) falha(`wrangler secret put falhou.\n${mascara(gravacao.saida)}`);
      console.log("Chave mestra gravada no Worker de medição (valor não exibido).");
    } else {
      console.log("Chave mestra já existia no Worker de medição; não foi trocada.");
    }

    const migracao = await executa(
      [wranglerJs, "d1", "migrations", "apply", BANCO, "-c", cfg, "--remote"],
      ambienteDoWrangler(env),
    );
    if (migracao.codigo !== 0) falha(`Migração remota falhou.\n${mascara(migracao.saida)}`);
    console.log("Migrações remotas ok.");

    // Preparo opcional do estado do banco de teste (só dados [TEST]), antes do aquecimento.
    for (const sql of pedido.setupSql ?? []) {
      const preparo = await executa(
        [wranglerJs, "d1", "execute", BANCO, "-c", cfg, "--remote", "--command", sql],
        ambienteDoWrangler(env),
      );
      if (preparo.codigo !== 0) falha(`Preparo do banco de medição falhou.\n${mascara(preparo.saida)}`);
    }

    tailFilho = spawn(process.execPath, [wranglerJs, "tail", WORKER, "--format", "json"], {
      cwd: raiz,
      env: ambienteDoWrangler(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let textoDoTail = "";
    tailFilho.stdout.on("data", (pedaco) => {
      textoDoTail += pedaco;
    });
    tailFilho.stderr.on("data", () => {});
    await esperar(ESPERA_ANTES_DAS_REQUISICOES_MS);

    for (const rota of pedido.requests) {
      for (let i = 0; i < AQUECIMENTO + MEDIDAS; i++) {
        const corpo = rota.body === undefined ? undefined : JSON.stringify(rota.body);
        const cabecalhos = { ...(rota.headers ?? {}) };
        if (corpo !== undefined && !("content-type" in cabecalhos))
          cabecalhos["content-type"] = "application/json";
        try {
          const resposta = await fetch(new URL(rota.path, urlDoWorker), {
            method: rota.method,
            headers: cabecalhos,
            body: corpo,
          });
          await resposta.arrayBuffer();
        } catch {
          falha(`Requisição ${rota.method} ${rota.path} falhou (rede).`);
        }
        await esperar(INTERVALO_ENTRE_REQUISICOES_MS);
      }
    }

    await esperar(ESPERA_DEPOIS_DAS_REQUISICOES_MS);
    tailFilho.kill();
    tailFilho = null;

    const porRota = new Map();
    for (const evento of eventosDoTail(textoDoTail)) {
      const requisicao = evento?.event?.request;
      if (typeof requisicao?.method !== "string" || typeof requisicao?.url !== "string") continue;
      const chave = `${requisicao.method} ${new URL(requisicao.url).pathname}`;
      if (!porRota.has(chave)) porRota.set(chave, []);
      porRota.get(chave).push({ ts: Number(evento.eventTimestamp ?? 0), cpu: evento.cpuTime });
    }

    const resultados = [];
    let faltou = false;
    for (const rota of pedido.requests) {
      const chave = `${rota.method} ${rota.path}`;
      const eventos = (porRota.get(chave) ?? []).sort((a, b) => a.ts - b.ts);
      const medidos = eventos.slice(AQUECIMENTO, AQUECIMENTO + MEDIDAS);
      if (medidos.length < MEDIDAS || medidos.some((evento) => typeof evento.cpu !== "number")) {
        faltou = true;
        resultados.push({
          name: rota.name,
          method: rota.method,
          path: rota.path,
          n: medidos.length,
          faltou: true,
        });
        continue;
      }
      const cpus = medidos.map((evento) => evento.cpu);
      resultados.push({
        name: rota.name,
        method: rota.method,
        path: rota.path,
        n: cpus.length,
        medianaMs: mediana(cpus),
        maximaMs: Math.max(...cpus),
        cpuMs: cpus,
        faltou: false,
      });
    }

    console.log("");
    console.log("| Requisição | n | mediana (ms) | máxima (ms) |");
    console.log("|---|---|---|---|");
    for (const r of resultados) {
      if (r.faltou) {
        console.log(`| ${r.name} | ${r.n} | faltou evento | faltou evento |`);
      } else {
        console.log(`| ${r.name} | ${r.n} | ${r.medianaMs.toFixed(3)} | ${r.maximaMs.toFixed(3)} |`);
      }
    }

    const pastaDeResultados = join(raiz, "test-results");
    mkdirSync(pastaDeResultados, { recursive: true });
    writeFileSync(
      join(pastaDeResultados, `cpu-${pedido.task}.json`),
      `${JSON.stringify({ task: pedido.task, medidoEm: new Date().toISOString(), limiteMs: LIMITE_MS, requests: resultados }, null, 2)}\n`,
    );

    if (faltou) falha("Faltou evento do tail para alguma requisição.");
    const acima = resultados.filter((r) => r.medianaMs >= LIMITE_MS);
    if (acima.length > 0) {
      falha(`Mediana igual ou acima de ${LIMITE_MS} ms: ${acima.map((r) => r.name).join(", ")}.`);
    }
  } finally {
    if (tailFilho) tailFilho.kill();
    soltaTrava();
  }
}

process.on("SIGINT", () => {
  if (tailFilho) tailFilho.kill();
  soltaTrava();
  process.exit(130);
});

main().then(
  () => {
    console.log("CPU medida: todas as medianas abaixo de 10 ms.");
    process.exit(0);
  },
  (erro) => {
    console.error(
      mascara(erro instanceof Falha ? erro.message : `Erro inesperado: ${erro?.message ?? erro}`),
    );
    process.exit(1);
  },
);
