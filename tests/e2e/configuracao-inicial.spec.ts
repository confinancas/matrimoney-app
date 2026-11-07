import { expect, type Page, test } from "@playwright/test";
import { PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { CODIGO_DE_TESTE, esperaInstalacao, preparaConfiguracaoDoZero } from "./helpers/setup";

// Instalação do zero (porta 8790, scripts/dev/e2e-server.mjs): nunca chega a "pronto" nos testes desta tela,
// então o D1 pode voltar à configuração antes de cada teste.
test.use({ baseURL: `http://127.0.0.1:${PORTA_DA_CONFIGURACAO}` });

// Chave falsa de teste: o stub (scripts/dev/anthropic-stub.mjs) responde pelo prefixo; nenhuma chave real passa aqui.
const CHAVE_VALIDA = "sk-ant-api03-TEST-valida";

const CAMPO_DO_CODIGO = "Código de primeiro acesso";
const CAMPO_DA_CHAVE = "Chave da API da Anthropic";

test.beforeAll(async () => {
  await esperaInstalacao(PORTA_DA_CONFIGURACAO);
});

test.beforeEach(() => {
  preparaConfiguracaoDoZero();
});

// Nas três larguras, a tela cabe sem rolagem horizontal.
async function semRolagemHorizontal(page: Page) {
  const medidas = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(medidas.conteudo).toBeLessThanOrEqual(medidas.janela);
}

async function digitaOCodigo(page: Page) {
  await page.getByLabel(CAMPO_DO_CODIGO).fill(CODIGO_DE_TESTE);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
}

// Cor computada branca com a opacidade dada, em rgb(a) ou oklab (o Chromium computa text-white/82 em oklab).
function ehBrancoComOpacidade(cor: string, opacidade: number): boolean {
  const rgb = /^rgba?\(255, 255, 255(?:, ([\d.]+))?\)$/.exec(cor);
  if (rgb) return Math.abs(Number(rgb[1] ?? 1) - opacidade) < 0.01;
  const oklab = /^oklab\(([\d.]+) ([-\d.e]+) ([-\d.e]+) \/ ([\d.]+)\)$/.exec(cor);
  if (!oklab) return false;
  const [l, a, b, alfa] = oklab.slice(1).map(Number) as [number, number, number, number];
  return l > 0.99 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01 && Math.abs(alfa - opacidade) < 0.01;
}

async function chegaAoPassoDaChave(page: Page) {
  await page.goto("/configuracao-inicial");
  await digitaOCodigo(page);
  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
}

test("a Abertura leva à configuração inicial quando a instalação não está pronta", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/configuracao-inicial$/);
  await expect(page.getByRole("heading", { name: "Configuração inicial" })).toBeVisible();
});

test("cenário 1: código, chave válida e o passo 3 com a chave mascarada; o assistente não aparece", async ({
  page,
}) => {
  await chegaAoPassoDaChave(page);

  await page.getByLabel(CAMPO_DA_CHAVE).fill(CHAVE_VALIDA);
  await page.getByRole("button", { name: "Testar e salvar" }).click();

  await expect(page.getByText("Chave salva: sk-ant-…lida")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tudo pronto para começar" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  // A chave nunca fica na tela depois de salva.
  expect(await page.content()).not.toContain(CHAVE_VALIDA);
  await semRolagemHorizontal(page);
});

test("cenário 2: #codigo= preenche, envia sozinho e o fragmento some da barra de endereço", async ({
  page,
}) => {
  await page.goto(`/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`);

  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
  await expect(page).toHaveURL(/\/configuracao-inicial$/);
});

test("cenário 3: código errado mostra a mensagem e não grava cookie", async ({ page, context }) => {
  await page.goto("/configuracao-inicial");

  await page.getByLabel(CAMPO_DO_CODIGO).fill("ABCD-EFGH-JKMN");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  await expect(
    page.getByText(
      "Código não confere. Confira no terminal ou rode npm run instalar de novo para gerar outro.",
    ),
  ).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "mm_setup")).toBe(false);
});

test("cenário 5: chave inválida e chave sem crédito mostram a mensagem do mapa, e nada é salvo", async ({
  page,
}) => {
  await chegaAoPassoDaChave(page);

  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-invalida");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Chave da Anthropic inválida. Confira se copiou a chave inteira.",
  );

  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-semcredito");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.",
  );

  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
});

test("cenário 6: Anthropic fora dá a mensagem de tentar de novo, e a tentativa seguinte salva", async ({
  page,
}) => {
  await chegaAoPassoDaChave(page);

  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-fora");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Não deu para falar com a Anthropic agora. A chave não foi salva: tente de novo em instantes.",
  );

  await page.getByLabel(CAMPO_DA_CHAVE).fill(CHAVE_VALIDA);
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByText("Chave salva: sk-ant-…lida")).toBeVisible();
});

test("cenário 12: recarregar no passo 2 volta ao passo 2, sem digitar o código de novo", async ({ page }) => {
  await chegaAoPassoDaChave(page);

  await page.reload();

  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
});

test("cenário 13: dois cliques em Testar e salvar mandam uma chamada só", async ({ page }) => {
  await chegaAoPassoDaChave(page);
  let chamadas = 0;
  page.on("request", (pedido) => {
    if (pedido.url().endsWith("/api/setup/keys/claude")) chamadas++;
  });

  await page.getByLabel(CAMPO_DA_CHAVE).fill(CHAVE_VALIDA);
  await page.getByRole("button", { name: "Testar e salvar" }).dblclick();

  await expect(page.getByText("Chave salva: sk-ant-…lida")).toBeVisible();
  expect(chamadas).toBe(1);
});

test("cenário 17: continuar sem IA pede confirmação dentro da tela e vai para o passo 3", async ({
  page,
}) => {
  await chegaAoPassoDaChave(page);

  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Continuar sem IA?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();

  await expect(page.getByText("Sem IA por enquanto. Dá para colar a chave em Configurações.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tudo pronto para começar" })).toBeVisible();
});

// Celular e tablet: a barra de passos fica dentro do topo verde, com texto branco (contraste sobre o verde).
// No desktop o painel verde é outro (à esquerda) e a barra fica na coluna do formulário, como antes.
test("a barra de passos fica dentro do topo verde, com texto branco, no celular e no tablet", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "no desktop a barra fica na coluna do formulário");
  await chegaAoPassoDaChave(page);

  const topo = page.locator("header").first();
  const barra = page.getByText("Passo 2 de 3 · Chave do Claude", { exact: true });
  const caixaDoTopo = await topo.boundingBox();
  const caixaDaBarra = await barra.boundingBox();
  expect(caixaDoTopo).not.toBeNull();
  expect(caixaDaBarra).not.toBeNull();
  if (!caixaDoTopo || !caixaDaBarra) return;
  expect(caixaDaBarra.y).toBeGreaterThanOrEqual(caixaDoTopo.y);
  expect(caixaDaBarra.y + caixaDaBarra.height).toBeLessThanOrEqual(caixaDoTopo.y + caixaDoTopo.height);

  const cor = await barra.evaluate((elemento) => getComputedStyle(elemento).color);
  expect(ehBrancoComOpacidade(cor, 0.82)).toBe(true);
});

test("no passo 3, sem cartão, o título fica abaixo do topo verde e não encosta na borda", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "no desktop não há topo verde");
  await chegaAoPassoDaChave(page);
  await page.getByLabel(CAMPO_DA_CHAVE).fill(CHAVE_VALIDA);
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  const titulo = page.getByRole("heading", { name: "Tudo pronto para começar" });
  await expect(titulo).toBeVisible();

  const topo = await page.locator("header").first().boundingBox();
  const caixaDoTitulo = await titulo.boundingBox();
  expect(topo).not.toBeNull();
  expect(caixaDoTitulo).not.toBeNull();
  if (!topo || !caixaDoTitulo) return;
  expect(caixaDoTitulo.y).toBeGreaterThanOrEqual(topo.y + topo.height + 16);
});
