#!/usr/bin/env node
// Prova que um app fino continua funcionando com o núcleo empacotado (TASK-0007).
// Faz npm pack do núcleo, copia tests/fixtures/app-fino para uma pasta temporária, instala o tarball nela,
// roda o build e o typecheck do app, faz o dry-run do Worker e confere: a tela e a rota sobrescritas, o resto
// do núcleo, a marca de teste no manifesto e no <title>, e que o catálogo do design system não entrou.
// Sem shell: o npm e o wrangler rodam pelo próprio Node, no Windows e no Linux. Sai com 1 em qualquer falha.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = join(raiz, "tests", "fixtures", "app-fino");
const TELA = "Tela sobrescrita pela fixture do app fino";
const ROTA_DO_NUCLEO = "/cartoes";
const proibidosNoWorker = ["Catálogo do design system", "/dev/catalogo"];
const soDevDependencies = ["vitest", "@playwright/test", "@biomejs/biome"];
const dependenciasDosScripts = ["@confinancas/core-money", "vite", "wrangler", "concurrently", "typescript"];

function falhar(mensagem) {
  throw new Error(mensagem);
}

// npm roda pelo npm-cli.js, com o Node: sem shell e sem o .cmd do Windows.
function localizarNpm() {
  const candidatos = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const achado = candidatos.find((candidato) => candidato?.endsWith("npm-cli.js") && existsSync(candidato));
  if (!achado) falhar("não achei o npm-cli.js.");
  return achado;
}

function ambiente() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  // O teste não precisa de conta: nenhum token da máquina entra no que roda aqui.
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  return env;
}

function rodar(comando, args, cwd) {
  const resultado = spawnSync(process.execPath, [comando, ...args], {
    cwd,
    encoding: "utf8",
    env: ambiente(),
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) {
    const fim = `${resultado.stdout ?? ""}\n${resultado.stderr ?? ""}`
      .trim()
      .split("\n")
      .slice(-30)
      .join("\n");
    falhar(`${basename(comando)} ${args.join(" ")} saiu com ${resultado.status}:\n${fim}`);
  }
  return resultado.stdout;
}

function arquivosEm(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivosEm(caminho) : [caminho];
  });
}

function escaparNaoAscii(texto) {
  return [...texto]
    .map((caractere) => {
      const codigo = caractere.charCodeAt(0);
      return codigo > 127 ? `\\u${codigo.toString(16).padStart(4, "0")}` : caractere;
    })
    .join("");
}

function conferirDependencias(app) {
  const nodeModules = join(app, "node_modules");
  for (const pacote of dependenciasDosScripts) {
    if (!existsSync(join(nodeModules, pacote, "package.json"))) {
      falhar(`${pacote} não foi instalado com o tarball, e os scripts do app dependem dele.`);
    }
  }
  for (const pacote of soDevDependencies) {
    if (existsSync(join(nodeModules, pacote)))
      falhar(`${pacote} (devDependency do núcleo) veio na instalação do tarball.`);
  }
}

function conferirBuildDoCliente(app, marca) {
  const saida = join(app, "dist", "client");
  const html = readFileSync(join(saida, "index.html"), "utf8");
  if (!html.includes(`<title>${marca.name}</title>`))
    falhar(`o <title> do index.html não é "${marca.name}".`);
  if (!html.includes(`content="${marca.colors.theme}"`))
    falhar("o theme-color do index.html não é o da marca de teste.");

  const manifesto = JSON.parse(readFileSync(join(saida, "manifest.webmanifest"), "utf8"));
  if (manifesto.name !== marca.name)
    falhar(`o manifesto tem o nome "${manifesto.name}", não "${marca.name}".`);
  if (manifesto.short_name !== marca.shortName)
    falhar("o short_name do manifesto não é o da marca de teste.");
  if (manifesto.theme_color !== marca.colors.theme)
    falhar("o theme_color do manifesto não é o da marca de teste.");
  for (const arquivo of [join(saida, "index.html"), join(saida, "manifest.webmanifest")]) {
    if (readFileSync(arquivo, "utf8").includes("Matrimoney"))
      falhar(`${basename(arquivo)} tem o nome de um app real.`);
  }

  const sw = readFileSync(join(saida, "sw.js"), "utf8");
  if (!/[;{,]self\.skipWaiting\(\)/.test(sw) || !/\.clientsClaim\(\)/.test(sw)) {
    falhar("o sw.js gerado não pede skipWaiting e clientsClaim (correção da TASK-0005 no preset).");
  }

  const javascript = arquivosEm(join(saida, "assets")).filter((arquivo) => arquivo.endsWith(".js"));
  const bundle = javascript.map((arquivo) => readFileSync(arquivo, "utf8")).join("\n");
  if (!bundle.includes(TELA)) falhar("a tela sobrescrita não está no bundle do cliente.");
  if (!bundle.includes(ROTA_DO_NUCLEO))
    falhar(`a rota do núcleo ${ROTA_DO_NUCLEO} sumiu do bundle do cliente.`);
}

// O nome do .js gerado vem do main (src/worker.ts vira worker.js), por isso não é fixo.
function arquivoDoWorker(app) {
  const pasta = join(app, "dist-worker");
  const javascript = readdirSync(pasta).filter((nome) => nome.endsWith(".js"));
  if (javascript.length !== 1)
    falhar(`o dry-run deveria gerar um .js do Worker, gerou ${javascript.length}.`);
  return join(pasta, javascript[0]);
}

function conferirTextoDoWorker(arquivo) {
  const conteudo = readFileSync(arquivo, "utf8");
  for (const proibido of proibidosNoWorker) {
    for (const forma of new Set([proibido, escaparNaoAscii(proibido)])) {
      if (conteudo.includes(forma)) falhar(`o Worker gerado traz o catálogo ("${proibido}").`);
    }
  }
}

// D1 falso da checagem: responde ao estado da instalação como pronta (TASK-0102). Sem isso, o portão da configuração
// fecharia a rota da fixture, e a checagem não chega à rota do app. Nenhuma consulta de dado real é feita aqui.
function bancoProntoFalso() {
  const linha = { has_key: 0, done: 1, unlocked: 0, members: 0, skipped_ai: 0 };
  const declaracao = () => ({
    bind: () => declaracao(),
    all: async () => ({ results: [linha], success: true, meta: {} }),
    first: async () => linha,
    run: async () => ({ results: [], success: true, meta: {} }),
    raw: async () => [Object.values(linha)],
  });
  return { prepare: () => declaracao(), batch: async () => [] };
}

async function conferirRotasDoWorker(arquivo, versaoDoApp) {
  const { default: worker } = await import(pathToFileURL(arquivo).href);
  const ambienteDoWorker = { DB: bancoProntoFalso() };
  const contexto = { waitUntil() {}, passThroughOnException() {} };

  const saude = await worker.fetch(new Request("http://teste.local/api/health"), ambienteDoWorker, contexto);
  const corpoSaude = await saude.json();
  if (saude.status !== 200 || corpoSaude.origem !== "app-fino-de-teste") {
    falhar(`/api/health não foi sobrescrita: status ${saude.status}, origem ${corpoSaude.origem}.`);
  }
  if (corpoSaude.versao !== versaoDoApp)
    falhar(`/api/health devolveu a versão ${corpoSaude.versao}, não a do app.`);

  const nova = await worker.fetch(new Request("http://teste.local/api/fixture"), ambienteDoWorker, contexto);
  const corpoNova = await nova.json();
  if (nova.status !== 200 || corpoNova.rota !== "/api/fixture")
    falhar("/api/fixture (rota nova do app) não respondeu.");

  const naoExiste = await worker.fetch(
    new Request("http://teste.local/api/nao-existe"),
    ambienteDoWorker,
    contexto,
  );
  if (naoExiste.status !== 404) falhar("a rota inexistente não respondeu 404 pelo núcleo.");
}

async function main() {
  const npm = localizarNpm();
  const marca = JSON.parse(readFileSync(join(fixture, "marca.json"), "utf8"));
  const versaoDoApp = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8")).version;
  const tmp = await mkdtemp(join(tmpdir(), "app-fino-"));

  try {
    console.log("check-app-fino: npm pack do núcleo");
    const [{ filename }] = JSON.parse(rodar(npm, ["pack", "--json", "--pack-destination", tmp], raiz));
    const tarball = join(tmp, filename);

    console.log("check-app-fino: copia a fixture para uma pasta temporária");
    const app = join(tmp, "app");
    await cp(fixture, app, { recursive: true, filter: (origem) => basename(origem) !== "node_modules" });

    console.log("check-app-fino: instala o tarball na fixture");
    rodar(npm, ["install", tarball, "--legacy-peer-deps", "--no-audit", "--no-fund"], app);
    conferirDependencias(app);

    console.log("check-app-fino: npm run build");
    rodar(npm, ["run", "build"], app);
    conferirBuildDoCliente(app, marca);

    console.log("check-app-fino: npm run typecheck");
    rodar(npm, ["run", "typecheck"], app);

    console.log("check-app-fino: wrangler deploy --dry-run");
    rodar(
      join(app, "node_modules", "wrangler", "bin", "wrangler.js"),
      ["deploy", "--dry-run", "--outdir", "dist-worker"],
      app,
    );
    const workerGerado = arquivoDoWorker(app);
    conferirTextoDoWorker(workerGerado);
    await conferirRotasDoWorker(workerGerado, versaoDoApp);

    console.log(
      "check-app-fino: ok. Tela e rota sobrescritas, o resto do núcleo e a marca de teste conferidos.",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((erro) => {
  console.error(`check-app-fino: falhou. ${erro.message}`);
  process.exitCode = 1;
});
