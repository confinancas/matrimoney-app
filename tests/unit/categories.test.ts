import { describe, expect, it } from "vitest";
import {
  buildCategoryTree,
  type CategoryDTO,
  type CategoryInput,
  type CategoryRef,
  defaultColorFor,
  filtrarCategorias,
  normalizeForCompare,
  ordenarCategorias,
  validateCategoryInput,
} from "../../src/shared/categories";
import { caminhoSeguro } from "../../src/web/screens/categorias/voltar";

const COR = "#7C4DFF";

const entrada = (parcial: Partial<CategoryInput> = {}): CategoryInput => ({
  name: "Pet",
  color: COR,
  parentId: null,
  aiHint: null,
  defaultSpendType: null,
  archived: false,
  ...parcial,
});

const existentes: CategoryRef[] = [
  { id: "mercado", name: "Mercado", parentId: null, archived: false },
  { id: "saude", name: "Saúde", parentId: null, archived: false },
  { id: "academia", name: "Academia", parentId: "saude", archived: false },
  { id: "farmacia", name: "Farmácia", parentId: "saude", archived: true },
  { id: "antigo", name: "Lavanderia", parentId: null, archived: true },
];

const erroDoCampo = (resultado: ReturnType<typeof validateCategoryInput>, campo: string) => {
  if (resultado.ok) throw new Error("esperava erro de validação");
  return resultado.fields[campo as keyof typeof resultado.fields];
};

describe("normalizeForCompare", () => {
  it("tira acento, caixa e espaços das pontas", () => {
    expect(normalizeForCompare("Saúde")).toBe(normalizeForCompare("saude"));
    expect(normalizeForCompare("Mércado")).toBe(normalizeForCompare("  MERCADO "));
    expect(normalizeForCompare("Mercado")).not.toBe(normalizeForCompare("Mercados"));
  });
});

describe("validateCategoryInput: a tabela de validação", () => {
  it("nome vazio (depois do trim) → 'Dê um nome à categoria.'", () => {
    const r = validateCategoryInput(entrada({ name: "   " }), existentes);
    expect(erroDoCampo(r, "name")).toBe("Dê um nome à categoria.");
  });

  it("nome com 41 caracteres → 'Use até 40 caracteres.'; 40 passa", () => {
    expect(erroDoCampo(validateCategoryInput(entrada({ name: "a".repeat(41) }), existentes), "name")).toBe(
      "Use até 40 caracteres.",
    );
    expect(validateCategoryInput(entrada({ name: "a".repeat(40) }), existentes).ok).toBe(true);
  });

  it("nome igual ao de uma ativa, sem acento e sem caixa → 'Já existe uma categoria com esse nome.'", () => {
    const r = validateCategoryInput(entrada({ name: "mércado" }), existentes);
    expect(erroDoCampo(r, "name")).toBe("Já existe uma categoria com esse nome.");
  });

  it("nome igual ao de uma arquivada não conta", () => {
    expect(validateCategoryInput(entrada({ name: "Lavanderia" }), existentes).ok).toBe(true);
  });

  it("editar mantendo o próprio nome não conta como repetido", () => {
    expect(validateCategoryInput(entrada({ name: "Mercado" }), existentes, "mercado").ok).toBe(true);
  });

  it("cor fora da paleta → 'Escolha uma das cores.'", () => {
    expect(erroDoCampo(validateCategoryInput(entrada({ color: "#000000" }), existentes), "color")).toBe(
      "Escolha uma das cores.",
    );
  });

  it("pai inexistente ou de outro lar (não está na lista) → 'Escolha uma categoria principal.'", () => {
    const r = validateCategoryInput(entrada({ parentId: "de-outro-lar" }), existentes);
    expect(erroDoCampo(r, "parentId")).toBe("Escolha uma categoria principal.");
  });

  it("pai arquivado, numa criação → 'Escolha uma categoria principal.'", () => {
    const r = validateCategoryInput(entrada({ parentId: "antigo" }), existentes);
    expect(erroDoCampo(r, "parentId")).toBe("Escolha uma categoria principal.");
  });

  it("pai que é subcategoria → 'Escolha uma categoria principal.'", () => {
    const r = validateCategoryInput(entrada({ parentId: "academia" }), existentes);
    expect(erroDoCampo(r, "parentId")).toBe("Escolha uma categoria principal.");
  });

  it("a própria categoria como pai → 'Escolha uma categoria principal.'", () => {
    const r = validateCategoryInput(entrada({ parentId: "mercado" }), existentes, "mercado");
    expect(erroDoCampo(r, "parentId")).toBe("Escolha uma categoria principal.");
  });

  it("principal com subcategorias ativas indo para dentro de outra → mensagem de um nível", () => {
    const r = validateCategoryInput(entrada({ name: "Saúde", parentId: "mercado" }), existentes, "saude");
    expect(erroDoCampo(r, "parentId")).toBe(
      "Uma categoria com subcategorias não pode ficar dentro de outra.",
    );
  });

  it("dica com 301 caracteres → 'Use até 300 caracteres.'", () => {
    expect(
      erroDoCampo(validateCategoryInput(entrada({ aiHint: "x".repeat(301) }), existentes), "aiHint"),
    ).toBe("Use até 300 caracteres.");
  });

  it("tipo fora de SPEND_TYPES → 'Tipo de gasto inválido.'", () => {
    expect(
      erroDoCampo(
        validateCategoryInput(entrada({ defaultSpendType: "nada" }), existentes),
        "defaultSpendType",
      ),
    ).toBe("Tipo de gasto inválido.");
  });

  it("reativar subcategoria com a principal arquivada → 'Reative antes a categoria principal.' (no campo archived)", () => {
    const r = validateCategoryInput(
      entrada({ name: "Farmácia", parentId: "saude", archived: false }),
      [
        ...existentes.filter((c) => c.id !== "saude"),
        { id: "saude", name: "Saúde", parentId: null, archived: true },
      ],
      "farmacia",
    );
    expect(erroDoCampo(r, "archived")).toBe("Reative antes a categoria principal.");
  });

  it("reativar com nome que agora pertence a outra ativa → 'Já existe...' no nome", () => {
    const r = validateCategoryInput(entrada({ name: "Mercado", archived: false }), existentes, "antigo");
    expect(erroDoCampo(r, "name")).toBe("Já existe uma categoria com esse nome.");
  });

  it("arquivada com pai arquivado, sem mudar nada (editar o nome) passa", () => {
    const r = validateCategoryInput(
      entrada({ name: "Farmácia nova", parentId: "saude", archived: true }),
      [
        ...existentes.filter((c) => c.id !== "saude"),
        { id: "saude", name: "Saúde", parentId: null, archived: true },
      ],
      "farmacia",
    );
    expect(r.ok).toBe(true);
  });

  it("valor normalizado: nome e dica sem as pontas; dica vazia vira nulo; cor em maiúsculas", () => {
    const r = validateCategoryInput(
      entrada({ name: "  Pet  ", aiHint: "   ", color: "#7c4dff" }),
      existentes,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.name).toBe("Pet");
      expect(r.valor.aiHint).toBeNull();
      expect(r.valor.color).toBe("#7C4DFF");
    }
  });

  it("juntas: as falhas de todos os campos voltam de uma vez", () => {
    const r = validateCategoryInput(
      entrada({ name: "", color: "#000000", aiHint: "x".repeat(301), defaultSpendType: "nada" }),
      existentes,
    );
    if (r.ok) throw new Error("esperava erro");
    expect(Object.keys(r.fields).sort()).toEqual(["aiHint", "color", "defaultSpendType", "name"]);
  });
});

const dto = (parcial: Partial<CategoryDTO> & Pick<CategoryDTO, "id" | "name">): CategoryDTO => ({
  color: COR,
  parentId: null,
  defaultSpendType: null,
  aiHint: null,
  sort: 0,
  archived: false,
  ...parcial,
});

describe("buildCategoryTree e ordenarCategorias", () => {
  const lista: CategoryDTO[] = [
    dto({ id: "outros", name: "Outros", sort: 1 }),
    dto({ id: "saude", name: "Saúde" }),
    dto({ id: "farmacia", name: "Farmácia", parentId: "saude" }),
    dto({ id: "academia", name: "Academia", parentId: "saude" }),
    dto({ id: "mercado", name: "mercado" }),
    dto({ id: "antigo", name: "Antiga", archived: true }),
    dto({ id: "lazer", name: "Lazer" }),
  ];

  it("principais por sort e nome sem caixa, subcategorias logo depois da principal, Outros (sort 1) por último", () => {
    const nomes = ordenarCategorias(lista).map((c) => c.name);
    expect(nomes).toEqual(["Antiga", "Lazer", "mercado", "Saúde", "Academia", "Farmácia", "Outros"]);
  });

  it("buildCategoryTree deixa as arquivadas de fora e agrupa as subcategorias", () => {
    const arvore = buildCategoryTree(lista);
    expect(arvore.map((n) => n.categoria.name)).toEqual(["Lazer", "mercado", "Saúde", "Outros"]);
    const saude = arvore.find((n) => n.categoria.id === "saude");
    expect(saude?.subcategorias.map((c) => c.name)).toEqual(["Academia", "Farmácia"]);
  });

  it("filtrar: quem casa leva a principal; se a principal casa, leva todas as subcategorias", () => {
    const arvore = buildCategoryTree(lista);
    const nomesDe = (busca: string) =>
      filtrarCategorias(arvore, busca).map((n) => [n.categoria.name, ...n.subcategorias.map((s) => s.name)]);

    expect(nomesDe("saude")).toEqual([["Saúde", "Academia", "Farmácia"]]);
    expect(nomesDe("farmacia")).toEqual([["Saúde", "Farmácia"]]);
    expect(nomesDe("xyz")).toEqual([]);
    expect(nomesDe("")).toEqual([["Lazer"], ["mercado"], ["Saúde", "Academia", "Farmácia"], ["Outros"]]);
  });
});

describe("defaultColorFor", () => {
  it("a primeira cor da paleta sem uso entre as principais ativas", () => {
    const lista = [
      dto({ id: "a", name: "A", color: "#7C4DFF" }),
      dto({ id: "b", name: "B", color: "#A78BFA" }),
    ];
    expect(defaultColorFor(lista)).toBe("#22B8E0");
  });

  it("todas as cores usadas → Roxo", () => {
    const paleta = [
      "#7C4DFF",
      "#A78BFA",
      "#22B8E0",
      "#22A06B",
      "#13B5A6",
      "#F7931E",
      "#F0559A",
      "#C06BEA",
      "#F9A8C9",
      "#1B84F2",
      "#C4995B",
      "#8794A8",
    ];
    const lista = paleta.map((cor, i) => dto({ id: `c${i}`, name: `C${i}`, color: cor }));
    expect(defaultColorFor(lista)).toBe("#7C4DFF");
  });

  it("com pai, a cor da principal", () => {
    const lista = [dto({ id: "saude", name: "Saúde", color: "#F0559A" })];
    expect(defaultColorFor(lista, "saude")).toBe("#F0559A");
  });
});

describe("caminhoSeguro (voltar)", () => {
  it("aceita caminho do app", () => {
    expect(caminhoSeguro("/inicio")).toBe("/inicio");
    expect(caminhoSeguro("/categorias/nova?pai=x")).toBe("/categorias/nova?pai=x");
  });

  it("recusa o que sai do app ou não começa com barra", () => {
    expect(caminhoSeguro(null)).toBeNull();
    expect(caminhoSeguro("")).toBeNull();
    expect(caminhoSeguro("inicio")).toBeNull();
    expect(caminhoSeguro("//evil.example")).toBeNull();
    expect(caminhoSeguro("/\\evil.example")).toBeNull();
    expect(caminhoSeguro("http://evil.example")).toBeNull();
    expect(caminhoSeguro("https://evil.example/x")).toBeNull();
  });
});
