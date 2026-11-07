import { expect, type Page, test } from "@playwright/test";
import type { CategoryDTO } from "../../src/shared/categories";

// Sem sessão real até a TASK-0104: a API (categorias, categorização da transação e regras) é simulada com page.route.
// O simulador não repete a regra do servidor: devolve o que a tela precisa e guarda o que a tela manda. A regra de
// verdade (chave, fatia, 409) é dos testes de integração.

const categoria = (
  id: string,
  name: string,
  color: string,
  parentId: string | null = null,
  sort = 0,
): CategoryDTO => ({
  id,
  name,
  color,
  parentId,
  defaultSpendType: null,
  aiHint: null,
  sort,
  archived: false,
});

const SEMENTE: CategoryDTO[] = [
  categoria("e2e-restaurantes", "Restaurantes e delivery", "#7C4DFF"),
  categoria("e2e-mercado", "Mercado", "#22B8E0"),
  categoria("e2e-casa", "Casa e contas", "#22A06B"),
  categoria("e2e-transporte", "Transporte", "#F7931E"),
  categoria("e2e-saude", "Saúde", "#F0559A"),
  categoria("e2e-lazer", "Lazer", "#13B5A6"),
  categoria("e2e-servicos", "Serviços", "#1B84F2"),
  categoria("e2e-outros", "Outros", "#8794A8", null, 1),
];

const SWITCH = "Aplicar a todas as compras deste estabelecimento";

type Estado = {
  // Restos da fatia retroativa, na ordem: cada chamada devolve o próximo valor (0 para terminar).
  restantesNasFatias: number[];
  // Quantas próximas chamadas de apply-retroactive falham (conexão caída).
  falhasNaFatia: number;
  fatias: number;
  puts: Array<{ categoryId: string; applyToAll: boolean }>;
};

async function simularApi(page: Page, restantesNasFatias: number[] = [0]): Promise<Estado> {
  const estado: Estado = {
    restantesNasFatias: [...restantesNasFatias],
    falhasNaFatia: 0,
    fatias: 0,
    puts: [],
  };
  await page.route("**/api/setup/status", (rota) =>
    rota.fulfill({ json: { mode: "pronto", unlocked: false, masterKeyOk: true, hasMembers: true } }),
  );
  await page.route("**/api/categories**", (rota) => rota.fulfill({ json: { categories: SEMENTE } }));
  await page.route("**/api/transactions/*/categorization", (rota) =>
    rota.fulfill({
      json: {
        transactionId: "e2e-compra-1",
        scope: "estabelecimento",
        matchLabel: "PAG*JOSEDASILVA",
        categoryId: null,
        aiCategoryId: "e2e-servicos",
        rule: null,
      },
    }),
  );
  await page.route("**/api/transactions/*/category", async (rota) => {
    const corpo = rota.request().postDataJSON() as { categoryId: string; applyToAll: boolean };
    estado.puts.push(corpo);
    const retroativo = corpo.applyToAll
      ? { applied: 2000, remaining: estado.restantesNasFatias.shift() ?? 0 }
      : null;
    return rota.fulfill({
      json: {
        transactionId: "e2e-compra-1",
        categoryId: corpo.categoryId,
        rule: corpo.applyToAll ? { id: "e2e-regra-1" } : null,
        retroactive: retroativo,
      },
    });
  });
  await page.route("**/api/rules/*/apply-retroactive", async (rota) => {
    if (estado.falhasNaFatia > 0) {
      estado.falhasNaFatia -= 1;
      return rota.abort();
    }
    // Atraso curto: o progresso fica visível por um instante antes da próxima fatia.
    await new Promise((resolve) => setTimeout(resolve, 600));
    estado.fatias += 1;
    return rota.fulfill({ json: { applied: 300, remaining: estado.restantesNasFatias.shift() ?? 0 } });
  });
  return estado;
}

// O switch liga por padrão numa compra; salvar com a categoria aplica a todas e volta com ela.
test("switch ligado por padrão: salvar aplica a todas e volta para a tela de origem", async ({ page }) => {
  const estado = await simularApi(page, [0]);
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  await expect(page.getByRole("switch", { name: SWITCH, exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText("Aplicar a todas de PAG*JOSEDASILVA", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Serviços/ }).click();
  await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe("/cartoes");
  expect(estado.puts).toEqual([{ categoryId: "e2e-servicos", applyToAll: true }]);
  expect(estado.fatias).toBe(0);
});

// Sobram compras antigas: a tela repete a fatia até zerar, mostrando quantas faltam, e só então volta.
test("progresso: mostra quantas faltam e só volta quando zera", async ({ page }) => {
  // A primeira fatia (a da própria gravação) deixa 150; a fatia seguinte zera.
  const estado = await simularApi(page, [150, 0]);
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  await page.getByRole("radio", { name: /Serviços/ }).click();
  await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("faltam 150");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/cartoes");
  expect(estado.fatias).toBe(1);
});

// Falha no meio: "Tentar de novo" retoma a fatia e termina.
test("falha no meio: Tentar de novo retoma e termina", async ({ page }) => {
  const estado = await simularApi(page, [300, 0]);
  estado.falhasNaFatia = 1;
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  await page.getByRole("radio", { name: /Serviços/ }).click();
  await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Não deu para aplicar a todas as compras antigas agora.",
  );
  await page.getByRole("button", { name: "Tentar de novo", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/cartoes");
  expect(estado.fatias).toBe(1);
});

// Falha no meio: "Deixar para depois" volta sem terminar (a regra já vale para as próximas).
test("falha no meio: Deixar para depois volta sem terminar", async ({ page }) => {
  const estado = await simularApi(page, [300]);
  estado.falhasNaFatia = 1;
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  await page.getByRole("radio", { name: /Serviços/ }).click();
  await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Não deu para aplicar a todas as compras antigas agora.",
  );
  await page.getByRole("button", { name: "Deixar para depois", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/cartoes");
  expect(estado.fatias).toBe(0);
});

// Switch desligado: só a compra muda; nenhuma regra e nenhuma fatia.
test("switch desligado: só a compra muda, sem fatia", async ({ page }) => {
  const estado = await simularApi(page, [0]);
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  await page.getByRole("switch", { name: SWITCH, exact: true }).click();
  await expect(page.getByRole("switch", { name: SWITCH, exact: true })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("radio", { name: /Serviços/ }).click();
  await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe("/cartoes");
  expect(estado.puts).toEqual([{ categoryId: "e2e-servicos", applyToAll: false }]);
  expect(estado.fatias).toBe(0);
});

// Sem transacao, o seletor segue como na TASK-0301: nenhum switch.
test("sem transacao: o seletor não mostra o switch", async ({ page }) => {
  await simularApi(page, [0]);
  await page.goto("/categorias/escolher");

  await expect(page.getByRole("radio", { name: "Mercado", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: SWITCH, exact: true })).toHaveCount(0);
});

// Nenhuma caixa nativa de confirmação, e nada passa da largura da tela.
test("sem window.confirm e sem rolagem horizontal, com o cartão visível", async ({ page }, testInfo) => {
  let caixas = 0;
  page.on("dialog", (caixa) => {
    caixas += 1;
    void caixa.dismiss();
  });
  await simularApi(page, [0]);
  await page.goto("/categorias/escolher?transacao=e2e-compra-1&voltar=/cartoes");

  const cartao = page.getByRole("region", { name: "Aplicar a todas" });
  await expect(cartao).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(caixas).toBe(0);

  if (testInfo.project.name === "desktop") {
    const lista = await page.getByRole("radiogroup", { name: "Categorias" }).boundingBox();
    const cartaoCaixa = await cartao.boundingBox();
    expect((cartaoCaixa?.x ?? 0) > (lista?.x ?? 0) + (lista?.width ?? 0)).toBe(true);
  }
});
