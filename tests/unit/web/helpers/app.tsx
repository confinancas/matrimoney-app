import { render } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { FeaturesProvider } from "@/app/features";
import { criarRotas } from "@/routes";

// Renderiza o app inteiro (roteador e moldura) numa rota, com a largura e os recursos pedidos.
export function renderizarApp({ rota, assistente = true }: { rota: InitialEntry; assistente?: boolean }) {
  const roteador = createMemoryRouter(criarRotas(), { initialEntries: [rota] });
  const resultado = render(
    <FeaturesProvider valores={{ ia: false, assistente, voz: false }}>
      <RouterProvider router={roteador} />
    </FeaturesProvider>,
  );
  return { ...resultado, roteador };
}
