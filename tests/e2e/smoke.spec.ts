import { expect, test } from "@playwright/test";
import { semearInstalacaoPronta } from "./helpers/setup";

test.beforeAll(() => {
  semearInstalacaoPronta();
});

test("a Abertura leva ao início, dentro da moldura", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", exact: true })).toBeVisible();
});

test("rota de SPA devolve a página, não 404", async ({ page }) => {
  const resposta = await page.goto("/rota/inexistente");

  expect(resposta?.status()).toBe(200);
  expect(resposta?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("rota de API inexistente devolve 404 JSON", async ({ request }) => {
  const resposta = await request.get("/api/nao-existe");

  expect(resposta.status()).toBe(404);
  expect(await resposta.json()).toEqual({ error: "rota_inexistente", message: "Rota não encontrada." });
});

test("a página não tem rolagem horizontal", async ({ page }) => {
  await page.goto("/inicio");
  await expect(page.getByRole("heading", { name: "Início", exact: true })).toBeVisible();

  const medidas = await page.evaluate(() => ({
    larguraDoConteudo: document.documentElement.scrollWidth,
    larguraDaJanela: window.innerWidth,
  }));
  expect(medidas.larguraDoConteudo).toBeLessThanOrEqual(medidas.larguraDaJanela);
});
