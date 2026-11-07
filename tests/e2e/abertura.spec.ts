import { expect, test } from "@playwright/test";
import { semearInstalacaoPronta } from "./helpers/setup";
import { marca } from "./marca";

test.beforeAll(() => {
  semearInstalacaoPronta();
});

// Cenário 12: a Abertura mostra a marca, espera a API e leva ao início.
test("a Abertura mostra a marca e vai para /inicio quando a API responde", async ({ page }) => {
  let liberar: () => void = () => undefined;
  const espera = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  await page.route("/api/health", async (rota) => {
    await espera;
    await rota.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("status", { name: `Abrindo o ${marca.name}` })).toBeVisible();
  await expect(page.locator("main img").first()).toHaveAttribute("src", "/icons/icon.svg");

  liberar();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("com a API bloqueada, mostra Sem conexão e Tentar de novo, que funciona quando a API volta", async ({
  page,
}) => {
  await page.route("/api/health", (rota) => rota.abort());

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sem conexão", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();

  await page.unroute("/api/health");
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("com reduzir movimento, o ícone da marca fica parado", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("/api/health", (rota) => rota.abort());

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sem conexão", exact: true })).toBeVisible();

  const animacao = await page
    .locator("main img")
    .first()
    .evaluate((elemento) => getComputedStyle(elemento).animationName);
  expect(animacao).toBe("none");
});

test("sem reduzir movimento, o ícone da marca respira", async ({ page }) => {
  let liberar: () => void = () => undefined;
  const espera = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  await page.route("/api/health", async (rota) => {
    await espera;
    await rota.continue();
  });

  await page.goto("/");
  const animacao = await page
    .locator("main img")
    .first()
    .evaluate((elemento) => getComputedStyle(elemento).animationName);
  expect(animacao).toBe("mm-respira");

  liberar();
  await expect(page).toHaveURL(/\/inicio$/);
});
