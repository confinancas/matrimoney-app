#!/usr/bin/env node
// Sobe o app para o Playwright: build no modo e2e (igual à produção), o stub da Anthropic e duas instâncias do wrangler dev.
// - porta 8788: a instalação pronta (os testes semeiam o primeiro acesso); é a do webServer do Playwright.
// - porta 8790: a configuração inicial do zero (TASK-0102). Existe à parte porque o Worker guarda "pronto" no módulo:
//   uma instalação que volta à configuração precisa de outro processo.
// Sem shell: roda os binários do node_modules com o próprio Node, no Windows e no Linux.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Chave mestra falsa e fixa, só do E2E: cifra as chaves de teste no D1 local.
const CHAVE_MESTRA_DO_E2E = "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=";
const PORTA_PRONTA = 8788;
const PORTA_CONFIGURACAO = 8790;
const PORTA_DO_STUB = 8789;

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const estadoPronto = join(".wrangler", "e2e-state");
const estadoConfiguracao = join(".wrangler", "e2e-state-configuracao");
const vite = join("node_modules", "vite", "bin", "vite.js");
const wrangler = join("node_modules", "wrangler", "bin", "wrangler.js");
const ambiente = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  MM_E2E_PORTA_DO_STUB: String(PORTA_DO_STUB),
};

function roda(args) {
  const resultado = spawnSync(process.execPath, args, { cwd: raiz, stdio: "inherit", env: ambiente });
  if (resultado.status !== 0) process.exit(resultado.status ?? 1);
}

// Cada wrangler dev tem a sua porta de inspeção (o padrão é a mesma para os dois, e o segundo não sobe no CI).
function sobeWrangler(porta, estado) {
  return spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(porta),
      "--inspector-port",
      String(porta + 1000),
      "--persist-to",
      estado,
      "--var",
      `MASTER_KEY:${CHAVE_MESTRA_DO_E2E}`,
      "--var",
      `ANTHROPIC_BASE_URL:http://127.0.0.1:${PORTA_DO_STUB}`,
    ],
    { cwd: raiz, stdio: "inherit", env: ambiente },
  );
}

rmSync(join(raiz, estadoPronto), { recursive: true, force: true });
rmSync(join(raiz, estadoConfiguracao), { recursive: true, force: true });
roda([vite, "build", "--mode", "e2e"]);
roda([wrangler, "d1", "migrations", "apply", "matrimoney-db", "--local", "--persist-to", estadoPronto]);
roda([wrangler, "d1", "migrations", "apply", "matrimoney-db", "--local", "--persist-to", estadoConfiguracao]);

const processos = [
  spawn(process.execPath, [join(raiz, "scripts", "dev", "anthropic-stub.mjs")], {
    cwd: raiz,
    stdio: "inherit",
    env: ambiente,
  }),
  sobeWrangler(PORTA_PRONTA, estadoPronto),
  sobeWrangler(PORTA_CONFIGURACAO, estadoConfiguracao),
];

function encerraTudo(sinal) {
  for (const processo of processos) processo.kill(sinal);
}

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    encerraTudo(sinal);
    process.exit(0);
  });
}

// Se um processo cai, os outros saem junto: o Playwright vê a falha em vez de testes pendurados.
for (const processo of processos) {
  processo.on("exit", (codigo) => {
    encerraTudo("SIGTERM");
    process.exit(codigo ?? 0);
  });
}
