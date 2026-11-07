# core-money — Guia do Repositório para Agentes

Núcleo dos apps de finanças da Confinanças (o Matrimoney, para casais, e depois o Meumoney), open source e auto-hospedados: cada pessoa instala na própria conta da Cloudflare, com as próprias chaves. Cada app tem um repositório fino, que usa este como dependência, presa a uma tag do GitHub (ADR-012 no doc). Conecta contas e cartões, categoriza as transações com IA (opcional) e oferece um assistente com voz (opcional). Idioma: português do Brasil. Stack: PWA em Hono + React (Vite), num Worker da Cloudflare, com banco D1 (ADR-006 e ADR-007 no doc). Estrutura e comandos: EPIC-00.

## Fonte da verdade

- **Comece pelo status**: `../money-doc/03-status/status-atual.md`.
- **Backlog/specs**: `../money-doc/` (épicos em `04-backlog/`, tasks em `04-backlog/tasks/`).
- **Processo obrigatório**: `../money-doc/05-guias/processo-de-desenvolvimento.md`. Trabalhe SOMENTE dentro do escopo da task designada; ao concluir, preencha a seção "Evidências" do arquivo da task e PARE para revisão. Bug fora do escopo: reporte, não conserte.
- **Guia operacional para agentes**: `../money-doc/05-guias/guia-execucao-agentes.md`. Leia antes de executar qualquer task.

## Comandos

- Instalar: `npm ci` (Node 22, conforme `.nvmrc`).
- Desenvolver: `npm run dev` (telas em http://localhost:5173, API em :8787, D1 local). Não precisa de conta na Cloudflare nem de `.env`.
- Ver como em produção: `npm run preview`.
- Banco local: `npm run db:migrate:local`.
- Gate, antes de entregar: `npm run gate` (lint, typecheck, testes unitários, build e integração), 2× seguidas.
- E2E: `npm run test:e2e` (obrigatório se a task tocou `src/web`, `index.html`, `vite.config.ts`, `preset/` ou arquivos públicos).
- CPU: `npm run cpu -- tests/cpu/TASK-NNXX.json` (obrigatório se a task criou ou mudou rota ou cron; precisa do `.env` no worktree).
- App fino: `npm run check:app-fino` monta uma fixture com o núcleo empacotado (`npm pack`, instalação, build, typecheck e dry-run). Quebrar um item de `exports` faz o job `app-fino` falhar.
- Arquivos locais a copiar para o worktree: `.env` da pasta principal, só para `npm run cpu`. O dev local e o gate não usam.

## Regras rígidas

1. **Nenhuma linha de código sem task especificada** e validada por Gustavo.
2. **Este repositório é público (open source).** Nunca commite `.env`, chave, token, senha, dado pessoal ou URL privada. Segredo commitado vaza para o mundo e tem que ser trocado.
3. **As chaves de quem instala vivem no banco**, entradas pelo app ([ADR-003](../money-doc/06-decisoes/ADR-003-chaves-no-banco.md)). Nenhuma rota devolve uma chave; chave nunca aparece em log ou mensagem de erro.
4. **Só o servidor fala com a Anthropic, o Google e o agregador de Open Finance.** O app (cliente) nunca recebe uma chave.
5. **Dado financeiro real nunca** em teste, fixture, log ou print. Testes usam dados fictícios prefixados `[TEST]`.
6. **Tudo cabe no plano gratuito da Cloudflare** ([ADR-008](../money-doc/06-decisoes/ADR-008-plano-gratuito.md)): cada rota e cada cron em até 10 ms de CPU, até 50 chamadas externas por execução (cada consulta ao D1 conta), consultas com índice e em lote. Regras em `../money-doc/02-arquitetura/plano-gratuito.md`.
7. **Git:** nunca commite nem faça push direto na `main`. Branch `task/<nnxx>-<slug>`, commits `TASK-NNXX: <verbo no imperativo>`, PR em rascunho contra a `main`, merge commit (nunca squash), merge só com o aceite da Fable e o "pode mergear" de Gustavo. O `money-doc` não tem proteção: o executor e a Fable commitam local, o Opus empurra.

## Arquitetura — o que você precisa saber

- Visão geral e o que está decidido: `../money-doc/02-arquitetura/stack-e-estrutura.md`.
- Limites do plano gratuito e o aviso de uso: `../money-doc/02-arquitetura/plano-gratuito.md`.
- Chaves, modo configuração e funções ligadas pela configuração: `../money-doc/02-arquitetura/configuracao-e-chaves.md`.
- IA (categorização, assistente, insights) e voz: `../money-doc/02-arquitetura/ia-e-voz.md`.
- Invariantes que toda revisão confere: `../money-doc/05-guias/guia-revisao.md`, seção 4.

## Armadilhas conhecidas (aprendidas na prática)

- **Pacote novo:** `npm install` precisa de `--legacy-peer-deps` (peer cíclico vite → @vitejs/devtools → vitest). `npm ci` não precisa.
- **Glob no TypeScript 7:** `dir/**` é recusado; use `dir/**/*`.
- **Windows:** scripts Node chamam `node node_modules/<pacote>/bin/...` com `spawn`, sem shell. Encerre todo processo que subiu (wrangler, workerd, vite, playwright), ou a pasta do worktree não pode ser apagada.
- **Proxy do Vite:** aponta para `127.0.0.1`; `localhost` resolve para `::1`, e o wrangler escuta em IPv4.
- **`wrangler tail`:** perde eventos em rajada, por isso o `npm run cpu` espaça as requisições em 1 s.
- **Testes de integração:** o D1 de teste é compartilhado e aplica chaves estrangeiras. O `vitest.integration.config.ts` roda um arquivo por vez (`fileParallelism: false`), e o setup esvazia as tabelas antes de cada teste, filhos antes dos pais.
- **Tailwind 4 não procura classes em `node_modules`:** o núcleo declara `@source ".."` em `src/web/styles/global.css`. Sem isso, as classes dos componentes somem nos apps finos.
- **Os apps finos só chamam `montarApp()`:** CSS e provedores ficam em `src/web/montar-app.tsx`, nunca em `src/web/main.tsx`. Caminhos do preset saem de `import.meta.url`, porque num app o núcleo está em `node_modules`.
- **shadcn:** o CLI não roda sem interação neste repositório; os componentes ficam escritos à mão em `src/web/components/ui/`.
- **`ON CONFLICT` numa chave única:** o `INSERT` não pode reusar o id da linha existente: a chave primária fica fora do conflito, e o SQLite falha. Gere um id novo em todo `INSERT`.
- **Limite do D1:** 100 parâmetros por comando. A gravação de movimentos usa 4 linhas por `INSERT`.
- **Caminhos do preset:** `marca` e `publicDir` são do app e saem de `process.cwd()`; o alias `@` vem de `import.meta.url`.
- **Vitest 4 não aplica o `define` aos projetos:** `__BRAND__` e `__DEV_ROUTES__` dos testes vêm de `tests/setup/globais.ts`.
- **Marca:** o nome não entra em `src/` nem em `index.html`; o teste `brand-literals` confere. `src/web/assets/rosto-ia.svg` não tem `<style>`: as animações estão no `global.css`.
- **Regra que decide pela vizinhança:** só escreve onde a vizinhança inteira está na leitura (ler ±10 dias para escrever ±5), em grupos de 45 ids, para caber em 100 parâmetros.
- **App fino e JSON:** `criarWorker({ marca })` precisa de cast no app, porque o JSON importado tem tipos alargados. O `concurrently` fica em `dependencies`, porque o `dev` do app o usa.
- **Instalador:** `scripts/instalar.ts` e `scripts/recuperar-acesso.ts` rodam na pasta do app, pelos `bin`. O estado fica em `.core-money/instalacao.json`, com nome fixo para qualquer marca. Os testes usam um runner falso; nenhum teste fala com a Cloudflare.
- **Medidor (`metered-d1`):** um comando preparado por um `Db` só entra no `batch` desse mesmo `Db`. Um `batch` com comando de outro medidor falha com `ZodError` do miniflare.
- **`rows_written` do D1:** conta as entradas de índice. Uma linha com dois índices sobre a coluna alterada conta mais que 1.
- **Lista de ids sem limite:** `json_each(?)`, com o JSON num único parâmetro, como em `src/worker/cycle/assign.ts`. Evita os grupos de 90.
- **Sonda do Pluggy:** `npm run -s pluggy:sonda`, porque o `-s` tira o cabeçalho do npm do stdout. As credenciais entram pelo terminal, nunca por arquivo. A fixture de 500 movimentos sai de `node tests/fixtures/pluggy/gerar-transactions-500.mjs`, seguida de `npx biome format --write` nela.
- **Modo configuração:** fora de `pronto`, o portão responde 503 a toda rota fora de `/api/setup/*` e `GET /api/health`. Teste que usa a API semeia `pronto` pelo auxiliar e chama `resetSetupCacheForTests()` antes, porque `pronto` fica em cache no módulo. O `wrangler dev` precisa do `.dev.vars` com `MASTER_KEY` (ver como-rodar).
- **E2E com duas instâncias:** 8788 (instalação pronta, semeada pelos testes) e 8790 (configuração do zero), cada uma com a própria porta de inspeção. Teste que volta à configuração usa só a 8790.
- **Medidor e Drizzle:** as leituras pelo `select` do Drizzle contam em `calls` e `statements`, mas não em `rowsRead`. Para medir linhas lidas, use `prepare().all()` direto.
- **Batch do Drizzle no D1:** `db.batch()` não aceita `db.run()` com SQL cru. Para SQL cru num batch, use `db.$client.batch(...)`, que é o binding medido.
