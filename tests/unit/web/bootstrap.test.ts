import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStartRoute, START_CHECKS } from "@/app/bootstrap";
import { ApiError } from "@/lib/api";

// Respostas por caminho: a saúde da API e o estado da instalação (a verificação da configuração lê o modo).
function comRespostas(modo: "configuracao" | "cadastro" | "pronto") {
  return vi.fn(async (caminho: string) => {
    if (caminho === "/api/setup/status") {
      return Response.json({ mode: modo, unlocked: false, masterKeyOk: true, hasMembers: false });
    }
    return Response.json({ ok: true, version: "0.1.0", at: "2026-11-07T00:00:00.000Z" });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveStartRoute", () => {
  it("com a saúde da API ok e a instalação pronta, vai para /inicio", async () => {
    vi.stubGlobal("fetch", comRespostas("pronto"));

    await expect(resolveStartRoute()).resolves.toBe("/inicio");
  });

  it("consulta GET /api/health", async () => {
    const fetchSimulado = comRespostas("pronto");
    vi.stubGlobal("fetch", fetchSimulado);

    await resolveStartRoute();

    expect(fetchSimulado).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("configuração pendente: vai para /configuracao-inicial (TASK-0102)", async () => {
    vi.stubGlobal("fetch", comRespostas("configuracao"));

    await expect(resolveStartRoute()).resolves.toBe("/configuracao-inicial");
  });

  it("cadastro (chave salva, primeiro acesso ainda não usado): também vai para a configuração", async () => {
    vi.stubGlobal("fetch", comRespostas("cadastro"));

    await expect(resolveStartRoute()).resolves.toBe("/configuracao-inicial");
  });

  it("com o fetch rejeitado, falha com ApiError sem_conexao", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const erro = await resolveStartRoute().catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({ status: 0, code: "sem_conexao" });
  });

  it("uma verificação que devolve uma rota vence as seguintes (as das próximas tasks)", async () => {
    vi.stubGlobal("fetch", comRespostas("pronto"));
    const verificacao = async () => "/entrar";
    START_CHECKS.unshift(verificacao);
    try {
      await expect(resolveStartRoute()).resolves.toBe("/entrar");
    } finally {
      START_CHECKS.shift();
    }
  });
});
