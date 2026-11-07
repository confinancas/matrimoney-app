import { describe, expect, it } from "vitest";
import { avisoDeTipoDaChave } from "@/settings/chave-da-ia";
import { initialSetupStep } from "@/setup/setup-step";
import type { SetupStatus } from "../../../src/shared/setup";

const estado = (parcial: Partial<SetupStatus>): SetupStatus => ({
  mode: "configuracao",
  unlocked: false,
  masterKeyOk: true,
  hasMembers: false,
  ...parcial,
});

describe("initialSetupStep", () => {
  it("pronto: vai para entrar, qualquer que seja o código", () => {
    expect(initialSetupStep(estado({ mode: "pronto", unlocked: true }))).toBe("entrar");
  });

  it("sem o código desbloqueado: passo 1, mesmo em cadastro", () => {
    expect(initialSetupStep(estado({ mode: "configuracao" }))).toBe(1);
    expect(initialSetupStep(estado({ mode: "cadastro", unlocked: false }))).toBe(1);
  });

  it("configuração com o código: passo 2 (a chave da IA)", () => {
    expect(initialSetupStep(estado({ mode: "configuracao", unlocked: true }))).toBe(2);
  });

  it("cadastro com o código (recarregar no meio): passo 3", () => {
    expect(initialSetupStep(estado({ mode: "cadastro", unlocked: true }))).toBe(3);
  });
});

describe("aviso de tipo da chave", () => {
  it("chave sk-ant- que não é sk-ant-api: aviso, sem bloquear", () => {
    expect(avisoDeTipoDaChave("sk-ant-outra-coisa")).toBe(
      "Essa chave parece ser de outro tipo. A chave da API começa com sk-ant-api.",
    );
  });

  it("chave da API comum e texto qualquer: sem aviso", () => {
    expect(avisoDeTipoDaChave("sk-ant-api03-TEST-0123")).toBeNull();
    expect(avisoDeTipoDaChave("qualquer coisa")).toBeNull();
    expect(avisoDeTipoDaChave("")).toBeNull();
  });

  it("ignora espaços nas pontas antes de conferir", () => {
    expect(avisoDeTipoDaChave("  sk-ant-api03-TEST  ")).toBeNull();
  });
});
