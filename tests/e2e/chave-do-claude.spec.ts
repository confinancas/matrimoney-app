import { expect, test } from "@playwright/test";
import { gravaChaveQueNaoAbre, semearInstalacaoPronta, zeraChavesDaInstalacaoPronta } from "./helpers/setup";

// Instalação pronta (porta 8788): as chaves são zeradas antes de cada teste; o primeiro acesso continua usado.
const CAMPO_DA_CHAVE = "Chave da API da Anthropic";

test.beforeAll(() => {
  semearInstalacaoPronta();
});

test.beforeEach(() => {
  zeraChavesDaInstalacaoPronta();
});

test("sem chave: a tela mostra Sem IA, o formulário aberto, e nenhum interruptor do assistente", async ({
  page,
}) => {
  await page.goto("/configuracoes/claude");

  await expect(page.getByRole("heading", { name: "Claude e assistente" })).toBeVisible();
  await expect(page.getByText("Sem IA", { exact: true })).toBeVisible();
  await expect(page.getByLabel(CAMPO_DA_CHAVE)).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  const medidas = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(medidas.conteudo).toBeLessThanOrEqual(medidas.janela);
});

test("cenário 14: a troca testa a chave nova; a recusada mantém a antiga, e a nova passa a valer", async ({
  page,
}) => {
  await page.goto("/configuracoes/claude");
  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-valida");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(
    page.getByText("Chave salva. A IA começa a sugerir em alguns minutos, inclusive nos meses antigos."),
  ).toBeVisible();
  await expect(page.getByText("sk-ant-…lida", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Trocar chave" }).click();
  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-semcredito");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "A conta da Anthropic está sem crédito. Adicione crédito em console.anthropic.com e tente de novo.",
  );
  await expect(page.getByText("sk-ant-…lida", { exact: true })).toBeVisible();

  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-valida-nova");
  await page.getByRole("button", { name: "Testar e salvar" }).click();
  await expect(page.getByText("Chave trocada.")).toBeVisible();
  await expect(page.getByText("sk-ant-…nova", { exact: true })).toBeVisible();
});

test("cenário 15: chave que não abre aparece como 'Não abre mais'; colar a chave de novo resolve", async ({
  page,
}) => {
  gravaChaveQueNaoAbre();

  await page.goto("/configuracoes/claude");
  await expect(page.getByText("Não abre mais", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A chave não abre nesta instalação (a chave mestra mudou). Cole a chave de novo."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Trocar chave" }).click();
  await page.getByLabel(CAMPO_DA_CHAVE).fill("sk-ant-api03-TEST-valida-nova");
  await page.getByRole("button", { name: "Testar e salvar" }).click();

  await expect(page.getByText("Chave trocada.")).toBeVisible();
  await expect(page.getByText("Conectada", { exact: true })).toBeVisible();
});
