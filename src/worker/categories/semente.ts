import type { CategoryRef } from "../../shared/categories";
import type { SpendType } from "../../shared/spend-types";

// Dados puros da semente (TASK-0301, decisão de 2026-11-03): 12 linhas da lista básica mais as três subcategorias
// que a tela de tipos usa. Os ids são determinísticos por lar, então duas leituras simultâneas não duplicam nada.
// Sem acesso ao D1 aqui: o teste unitário lê estes dados direto.
export type SementeCategoria = {
  slug: string;
  nome: string;
  pai: string | null;
  cor: string;
  tipo: SpendType | null;
  sort: number;
};

export const CATEGORY_SEED: readonly SementeCategoria[] = [
  {
    slug: "restaurantes",
    nome: "Restaurantes e delivery",
    pai: null,
    cor: "#7C4DFF",
    tipo: "prazeres",
    sort: 0,
  },
  { slug: "mercado", nome: "Mercado", pai: null, cor: "#22B8E0", tipo: "fixos", sort: 0 },
  { slug: "casa-contas", nome: "Casa e contas", pai: null, cor: "#22A06B", tipo: "fixos", sort: 0 },
  { slug: "transporte", nome: "Transporte", pai: null, cor: "#F7931E", tipo: "fixos", sort: 0 },
  {
    slug: "manutencao-carro",
    nome: "Manutenção do carro",
    pai: "transporte",
    cor: "#F7931E",
    tipo: "extras",
    sort: 0,
  },
  { slug: "assinaturas", nome: "Assinaturas", pai: null, cor: "#A78BFA", tipo: "conforto", sort: 0 },
  { slug: "saude", nome: "Saúde", pai: null, cor: "#F0559A", tipo: null, sort: 0 },
  { slug: "academia", nome: "Academia", pai: "saude", cor: "#F0559A", tipo: "fixos", sort: 0 },
  { slug: "farmacia", nome: "Farmácia", pai: "saude", cor: "#F0559A", tipo: "extras", sort: 0 },
  { slug: "cuidados-pessoais", nome: "Cuidados pessoais", pai: null, cor: "#C06BEA", tipo: null, sort: 0 },
  { slug: "educacao", nome: "Educação", pai: null, cor: "#C4995B", tipo: "educacao", sort: 0 },
  { slug: "lazer", nome: "Lazer", pai: null, cor: "#13B5A6", tipo: "prazeres", sort: 0 },
  { slug: "presentes", nome: "Presentes", pai: null, cor: "#F9A8C9", tipo: null, sort: 0 },
  { slug: "servicos", nome: "Serviços", pai: null, cor: "#1B84F2", tipo: null, sort: 0 },
  { slug: "outros", nome: "Outros", pai: null, cor: "#8794A8", tipo: null, sort: 1 },
];

// Os pais vêm antes dos filhos na lista: o INSERT do filho confere a chave estrangeira na hora.
export const seedId = (householdId: string, slug: string): string => `seed:${householdId}:${slug}`;

// As categorias da semente como o validador as vê (todas ativas), para decidir antes de gravar a semente.
export function seedRefs(householdId: string): CategoryRef[] {
  return CATEGORY_SEED.map((semente) => ({
    id: seedId(householdId, semente.slug),
    name: semente.nome,
    parentId: semente.pai === null ? null : seedId(householdId, semente.pai),
    archived: false,
  }));
}
