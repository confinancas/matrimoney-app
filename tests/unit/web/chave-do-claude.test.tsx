import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChaveDoClaude } from "@/screens/configuracoes/ChaveDoClaude";

const MENSAGEM_CHAVE_MESTRA = "A instalação está incompleta";

// GET /api/settings/keys responde com erro 500 e o código dado.
function responderErro(codigo: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: codigo, message: "Erro interno." }, { status: 500 })),
  );
}

function renderizar() {
  render(
    <MemoryRouter>
      <ChaveDoClaude assistenteDisponivel={false} />
    </MemoryRouter>,
  );
}

describe("ChaveDoClaude: erro ao carregar as chaves", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("500 com chave_mestra_ausente: mostra a mensagem da chave mestra", async () => {
    responderErro("chave_mestra_ausente");
    renderizar();

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_CHAVE_MESTRA);
    expect(screen.queryByText("Não foi possível carregar")).not.toBeInTheDocument();
  });

  it("500 com outro código: mostra o erro genérico e não a mensagem da chave mestra", async () => {
    responderErro("erro_interno");
    renderizar();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar");
    expect(document.body).not.toHaveTextContent(MENSAGEM_CHAVE_MESTRA);
  });
});
