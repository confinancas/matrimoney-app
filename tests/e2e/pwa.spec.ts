import { expect, test } from "@playwright/test";
import { semearInstalacaoPronta } from "./helpers/setup";
import { marca } from "./marca";

test.beforeAll(() => {
  semearInstalacaoPronta();
});

// Cenário 13: o app é instalável, o service worker registra e a moldura abre offline do cache.

test("o manifesto tem nome, ícones 192, 512 e maskable, standalone e start_url /", async ({ request }) => {
  const resposta = await request.get("/manifest.webmanifest");
  expect(resposta.status()).toBe(200);
  const manifesto = (await resposta.json()) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    lang: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifesto.name).toBe(marca.name);
  expect(manifesto.start_url).toBe("/");
  expect(manifesto.scope).toBe("/");
  expect(manifesto.display).toBe("standalone");
  expect(manifesto.lang).toBe("pt-BR");
  expect(manifesto.icons.some((icone) => icone.sizes === "192x192")).toBe(true);
  expect(manifesto.icons.some((icone) => icone.sizes === "512x512" && !icone.purpose)).toBe(true);
  expect(manifesto.icons.some((icone) => icone.sizes === "512x512" && icone.purpose === "maskable")).toBe(
    true,
  );
});

test("o ícone da marca é servido em /icons", async ({ request }) => {
  for (const caminho of ["/icons/icon.svg", "/icons/icon-192.png", "/icons/apple-touch-icon.png"]) {
    const resposta = await request.get(caminho);
    expect(resposta.status(), caminho).toBe(200);
  }
});

test("o service worker registra e, offline, /inicio abre do cache com a moldura; /api nunca vem do cache", async ({
  page,
  context,
}) => {
  await page.goto("/inicio");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A primeira carga não é controlada pelo service worker: recarrega para ele assumir a página.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Com a página já no cache, cada abertura sem rede vem do service worker.
  await context.setOffline(true);
  await page.goto("/inicio");
  await expect(page.getByRole("heading", { name: "Início", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

  // /api/* não é respondido pelo service worker: sem rede, a chamada falha em vez de receber resposta em cache.
  const resultadoDaApi = await page.evaluate(() =>
    fetch("/api/health").then(
      () => "respondeu",
      () => "falhou",
    ),
  );
  expect(resultadoDaApi).toBe("falhou");

  await context.setOffline(false);
  const urlsNoCache = await page.evaluate(async () => {
    const nomes = await caches.keys();
    const urls: string[] = [];
    for (const nome of nomes) {
      for (const requisicao of await (await caches.open(nome)).keys()) urls.push(requisicao.url);
    }
    return urls;
  });
  expect(urlsNoCache.some((url) => new URL(url).pathname.startsWith("/api/"))).toBe(false);
});
