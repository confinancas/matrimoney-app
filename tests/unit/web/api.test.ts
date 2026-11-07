import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, definirAcaoDaConfiguracaoPendente } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function comFetch(resposta: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(resposta));
}

describe("apiFetch", () => {
  it("devolve o corpo de uma resposta 2xx", async () => {
    comFetch(async () => Response.json({ ok: true }));

    await expect(apiFetch<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
  });

  it("usa cookies da mesma origem e pede JSON", async () => {
    const fetchSimulado = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchSimulado);

    await apiFetch("/api/health");

    const [, init] = fetchSimulado.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("corpo de erro da convenção: vira ApiError com código, mensagem e campos", async () => {
    comFetch(async () =>
      Response.json(
        { error: "dados_invalidos", message: "Confira o nome.", fields: { nome: "Obrigatório." } },
        { status: 422 },
      ),
    );

    const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({
      status: 422,
      code: "dados_invalidos",
      message: "Confira o nome.",
      fields: { nome: "Obrigatório." },
    });
  });

  it("corpo de erro sem mensagem: usa a mensagem padrão, sem detalhe técnico", async () => {
    comFetch(async () => Response.json({ error: "nao_autenticado" }, { status: 401 }));

    const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

    expect(erro).toMatchObject({
      status: 401,
      code: "nao_autenticado",
      message: "Algo deu errado. Tente de novo.",
    });
  });

  it("corpo que não é da convenção (HTML, texto): erro_http com a mensagem padrão", async () => {
    comFetch(async () => new Response("<html>502</html>", { status: 502 }));

    const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

    expect(erro).toMatchObject({
      status: 502,
      code: "erro_http",
      message: "Algo deu errado. Tente de novo.",
    });
  });

  it("falha de rede: ApiError com status 0 e sem_conexao", async () => {
    comFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

    expect(erro).toMatchObject({ status: 0, code: "sem_conexao", message: "Sem conexão." });
  });

  it("204 sem corpo: devolve undefined, sem erro de JSON", async () => {
    comFetch(async () => new Response(null, { status: 204 }));

    await expect(apiFetch("/api/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("503 configuracao_pendente chama a ação de configuração uma vez, e lança o erro", async () => {
    const acao = vi.fn();
    const restaurar = definirAcaoDaConfiguracaoPendente(acao);
    try {
      comFetch(async () =>
        Response.json({ error: "configuracao_pendente", message: "Configuração pendente." }, { status: 503 }),
      );

      const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

      expect(acao).toHaveBeenCalledTimes(1);
      expect(erro).toMatchObject({ status: 503, code: "configuracao_pendente" });
    } finally {
      restaurar();
    }
  });

  it("outro 503 não leva à configuração", async () => {
    const acao = vi.fn();
    const restaurar = definirAcaoDaConfiguracaoPendente(acao);
    try {
      comFetch(async () => Response.json({ error: "anthropic_indisponivel", message: "x" }, { status: 503 }));

      await apiFetch("/api/x").catch(() => undefined);

      expect(acao).not.toHaveBeenCalled();
    } finally {
      restaurar();
    }
  });
});
