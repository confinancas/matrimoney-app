import { describe, expect, it } from "vitest";
import { CATEGORY_PALETTE } from "../../src/shared/categories";
import { SPEND_TYPES } from "../../src/shared/spend-types";
import { CATEGORY_SEED, seedId, seedRefs } from "../../src/worker/categories/semente";

const cores = new Set<string>(CATEGORY_PALETTE.map((paleta) => paleta.cor));
const tipos = new Set(SPEND_TYPES.map((tipo) => tipo.id));

describe("semente de categorias", () => {
  it("tem 15 categorias: as 12 da lista mais Manutenção do carro, Academia e Farmácia", () => {
    expect(CATEGORY_SEED).toHaveLength(15);
    const subcategorias = CATEGORY_SEED.filter((semente) => semente.pai !== null).map((s) => s.nome);
    expect(subcategorias.sort()).toEqual(["Academia", "Farmácia", "Manutenção do carro"]);
  });

  it("slugs e nomes são únicos", () => {
    expect(new Set(CATEGORY_SEED.map((s) => s.slug)).size).toBe(CATEGORY_SEED.length);
    expect(new Set(CATEGORY_SEED.map((s) => s.nome)).size).toBe(CATEGORY_SEED.length);
  });

  it("cores estão na paleta e os tipos são válidos (ou nulos)", () => {
    for (const semente of CATEGORY_SEED) {
      expect(cores.has(semente.cor), semente.nome).toBe(true);
      if (semente.tipo !== null) expect(tipos.has(semente.tipo), semente.nome).toBe(true);
    }
  });

  it("todo pai existe, é principal (um nível só) e vem antes da subcategoria", () => {
    const posicoes = new Map(CATEGORY_SEED.map((semente, indice) => [semente.slug, indice]));
    for (const [indice, semente] of CATEGORY_SEED.entries()) {
      if (semente.pai === null) continue;
      const pai = CATEGORY_SEED.find((candidata) => candidata.slug === semente.pai);
      expect(pai, semente.nome).toBeDefined();
      expect(pai?.pai, semente.nome).toBeNull();
      expect(posicoes.get(semente.pai) ?? -1, semente.nome).toBeLessThan(indice);
    }
  });

  it("Outros fica por último, com sort 1; o resto tem sort 0", () => {
    const outros = CATEGORY_SEED.find((semente) => semente.nome === "Outros");
    expect(outros?.sort).toBe(1);
    expect(CATEGORY_SEED.filter((semente) => semente.nome !== "Outros").every((s) => s.sort === 0)).toBe(
      true,
    );
  });

  it("ids determinísticos por lar: o do pai é o id da principal, e lares diferentes não colidem", () => {
    expect(seedId("lar-1", "saude")).toBe("seed:lar-1:saude");
    const refs = seedRefs("lar-1");
    const academia = refs.find((ref) => ref.name === "Academia");
    expect(academia?.parentId).toBe(seedId("lar-1", "saude"));
    const outroLar = seedRefs("lar-2").map((ref) => ref.id);
    expect(refs.map((ref) => ref.id).some((id) => outroLar.includes(id))).toBe(false);
  });
});
