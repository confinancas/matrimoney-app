import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/worker/app";
import { callApi, semearPronto } from "./helpers/app";

describe("erros da API", () => {
  beforeEach(async () => {
    await semearPronto(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rota inexistente devolve 404 JSON, nunca a página", async () => {
    const resposta = await callApi(createApp(), "GET", "/api/nao-existe");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "rota_inexistente", message: "Rota não encontrada." });
  });

  it("rota que lança devolve 500 genérico, sem a mensagem do erro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({
      rotasDoApp: (rotas) => {
        rotas.get("/erro-teste", () => {
          throw new Error("segredo-de-teste");
        });
      },
    });

    const resposta = await callApi(app, "GET", "/api/erro-teste");

    expect(resposta.status).toBe(500);
    const texto = await resposta.text();
    expect(JSON.parse(texto)).toEqual({ error: "erro_interno", message: "Algo deu errado. Tente de novo." });
    expect(texto).not.toContain("segredo-de-teste");
  });

  it("onMeter roda uma vez por requisição, inclusive em 404 e 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onMeter = vi.fn();
    const app = createApp({
      onMeter,
      rotasDoApp: (rotas) => {
        rotas.get("/erro-teste", () => {
          throw new Error("segredo-de-teste");
        });
      },
    });

    await callApi(app, "GET", "/api/nao-existe");
    expect(onMeter).toHaveBeenCalledTimes(1);

    await callApi(app, "GET", "/api/erro-teste");
    expect(onMeter).toHaveBeenCalledTimes(2);
  });
});
