import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider, useAtualizarFeatures, useFeatures } from "@/app/features";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mostra o valor da IA e tem um botão que relê GET /api/features.
function Consumidor() {
  const funcoes = useFeatures();
  const atualizar = useAtualizarFeatures();
  return (
    <div>
      <p>{funcoes.ia ? "ia ligada" : "ia desligada"}</p>
      <button type="button" onClick={atualizar}>
        Reler
      </button>
    </div>
  );
}

describe("FeaturesProvider", () => {
  it("num erro de GET /api/features, mantém o último valor lido", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ia: true, assistente: false, voz: false }))
        .mockRejectedValueOnce(new TypeError("fetch failed")),
    );
    render(
      <FeaturesProvider>
        <Consumidor />
      </FeaturesProvider>,
    );
    expect(await screen.findByText("ia ligada")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reler" }));
    // Deixa a falha da segunda leitura chegar ao provedor antes de conferir.
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("ia ligada")).toBeVisible();
  });

  it("com a releitura bem-sucedida, o valor novo substitui o anterior", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ia: true, assistente: false, voz: false }))
        .mockResolvedValueOnce(Response.json({ ia: false, assistente: false, voz: false })),
    );
    render(
      <FeaturesProvider>
        <Consumidor />
      </FeaturesProvider>,
    );
    expect(await screen.findByText("ia ligada")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reler" }));

    expect(await screen.findByText("ia desligada")).toBeVisible();
  });
});
