import { expect, type Page, test } from "@playwright/test";
import type { CategoryDTO } from "../../src/shared/categories";

// Sem sessão real até a TASK-0104: a API de categorias é simulada com page.route. O simulador devolve a semente
// com os tipos do CategoryDTO e guarda o que for criado; não repete regra de validação (essa é da API e do teste de integração).
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
  categoria("e2e-manutencao", "Manutenção do carro", "#F7931E", "e2e-transporte"),
  categoria("e2e-assinaturas", "Assinaturas", "#A78BFA"),
  categoria("e2e-saude", "Saúde", "#F0559A"),
  categoria("e2e-academia", "Academia", "#F0559A", "e2e-saude"),
  categoria("e2e-farmacia", "Farmácia", "#F0559A", "e2e-saude"),
  categoria("e2e-cuidados", "Cuidados pessoais", "#C06BEA"),
  categoria("e2e-educacao", "Educação", "#C4995B"),
  categoria("e2e-lazer", "Lazer", "#13B5A6"),
  categoria("e2e-presentes", "Presentes", "#F9A8C9"),
  categoria("e2e-servicos", "Serviços", "#1B84F2"),
  categoria("e2e-outros", "Outros", "#8794A8", null, 1),
];

async function simularApi(page: Page) {
  const estado = { falhar: false };
  const criadas: CategoryDTO[] = [];
  await page.route("**/api/setup/status", (rota) =>
    rota.fulfill({ json: { mode: "pronto", unlocked: false, masterKeyOk: true, hasMembers: true } }),
  );
  await page.route("**/api/categories**", async (rota) => {
    if (estado.falhar) return rota.abort();
    const pedido = rota.request();
    if (pedido.method() === "POST") {
      const corpo = pedido.postDataJSON() as Partial<CategoryDTO>;
      const nova: CategoryDTO = {
        ...categoria(
          `e2e-nova-${criadas.length + 1}`,
          corpo.name ?? "",
          corpo.color ?? "",
          corpo.parentId ?? null,
        ),
        aiHint: corpo.aiHint ?? null,
      };
      criadas.push(nova);
      return rota.fulfill({ status: 201, json: { category: nova } });
    }
    return rota.fulfill({ json: { categories: [...SEMENTE, ...criadas] } });
  });
  return estado;
}

// Cenário 4: criar pelo seletor e voltar com a nova selecionada.
test("cenário 4: criar '[TEST] Pet' com cor Rosa e voltar ao seletor com ela selecionada", async ({
  page,
}) => {
  await simularApi(page);
  await page.goto("/categorias/escolher");
  await expect(page.getByRole("radio", { name: "Mercado", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Nova categoria", exact: true }).click();
  await expect(page).toHaveURL(/\/categorias\/nova\?/);
  await page.getByLabel("Nome", { exact: true }).fill("[TEST] Pet");
  await page.getByRole("radio", { name: "Rosa", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Criar categoria" }).click();

  await expect(page).toHaveURL(/\/categorias\/escolher$/);
  await expect(page.getByRole("radio", { name: "[TEST] Pet", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

// Cenário 5: a subcategoria abre o formulário com a principal e a cor dela.
test("cenário 5: 'Subcategoria em Saúde' abre o formulário com Dentro de = Saúde e a cor Rosa", async ({
  page,
}) => {
  await simularApi(page);
  await page.goto("/categorias/escolher");

  await page.getByRole("link", { name: "Subcategoria em Saúde", exact: true }).click();

  await expect(page.getByLabel("Dentro de", { exact: true })).toHaveValue("e2e-saude");
  await expect(page.getByRole("radio", { name: "Rosa", exact: true })).toBeChecked();
});

// Cenário 9: a sugestão da IA aparece na categoria indicada; Salvar só habilita com seleção.
test("cenário 9: 'sugestão da IA' em Serviços; Salvar desabilitado sem seleção e alvo de 44 px", async ({
  page,
}) => {
  await simularApi(page);
  await page.goto("/categorias/escolher?sugerida=e2e-servicos");

  const servicos = page.getByRole("radio", { name: /Serviços/ });
  await expect(servicos).toContainText("sugestão da IA");
  const salvar = page.getByRole("button", { name: "Salvar categoria", exact: true });
  await expect(salvar).toBeDisabled();
  const alvo = await servicos.boundingBox();
  expect(alvo?.height ?? 0).toBeGreaterThanOrEqual(44);

  await servicos.click();
  await expect(salvar).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// Cenário 10: a busca sem acento e sem caixa; subcategorias de uma principal que casa; mensagem quando nada casa.
test("cenário 10: busca 'saude' traz Saúde, Academia e Farmácia; 'xyz' mostra a mensagem vazia", async ({
  page,
}) => {
  await simularApi(page);
  await page.goto("/categorias/escolher");

  const busca = page.getByLabel("Buscar categoria", { exact: true });
  await busca.fill("saude");
  for (const nome of ["Saúde", "Academia", "Farmácia"]) {
    await expect(page.getByRole("radio", { name: nome, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Subcategoria em/ })).toHaveCount(0);

  await busca.fill("xyz");
  await expect(page.getByText("Nenhuma categoria encontrada.", { exact: true })).toBeVisible();
});

// Cenário 12: falha da API mostra o erro com Tentar de novo, que recarrega quando a API volta.
test("cenário 12: com a API fora, mostra o erro e Tentar de novo carrega a lista", async ({ page }) => {
  const estado = await simularApi(page);
  estado.falhar = true;
  await page.goto("/categorias/escolher");

  await expect(page.getByRole("alert")).toContainText("Não deu para carregar as categorias.");
  estado.falhar = false;
  await page.getByRole("button", { name: "Tentar de novo", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Mercado", exact: true })).toBeVisible();
});
