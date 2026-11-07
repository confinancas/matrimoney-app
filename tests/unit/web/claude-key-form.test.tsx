import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { ClaudeKeyForm } from "@/settings/ClaudeKeyForm";

const CHAVE = "sk-ant-api03-TEST-form-0123456789";

describe("ClaudeKeyForm", () => {
  // Sem globals no Vitest, o RTL não limpa sozinho entre os testes.
  afterEach(() => cleanup());

  it("tem o campo da chave, a ajuda e o botão de testar e salvar", () => {
    render(<ClaudeKeyForm aoSalvar={vi.fn()} />);

    expect(screen.getByLabelText("Chave da API da Anthropic")).toHaveAttribute("type", "password");
    expect(
      screen.getByText("Fica guardada cifrada no seu servidor e nunca mais aparece inteira."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Testar e salvar" })).toBeVisible();
  });

  it("Mostrar e Ocultar trocam o tipo do campo", async () => {
    const user = userEvent.setup();
    render(<ClaudeKeyForm aoSalvar={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByLabelText("Chave da API da Anthropic")).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.getByLabelText("Chave da API da Anthropic")).toHaveAttribute("type", "password");
  });

  it("chave de outro tipo: mostra o aviso e não bloqueia o envio", async () => {
    const user = userEvent.setup();
    render(<ClaudeKeyForm aoSalvar={vi.fn(async () => undefined)} />);

    await user.type(screen.getByLabelText("Chave da API da Anthropic"), "sk-ant-outra-coisa");

    expect(screen.getByText(/parece ser de outro tipo/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Testar e salvar" })).toBeEnabled();
  });

  it("envia a chave sem espaços nas pontas, uma vez mesmo com dois cliques, e mostra o estado de espera", async () => {
    const user = userEvent.setup();
    let liberar: () => void = () => undefined;
    const aoSalvar = vi.fn(
      () =>
        new Promise<void>((resolver) => {
          liberar = resolver;
        }),
    );
    render(<ClaudeKeyForm aoSalvar={aoSalvar} />);

    await user.type(screen.getByLabelText("Chave da API da Anthropic"), `  ${CHAVE}  `);
    const botao = screen.getByRole("button", { name: "Testar e salvar" });
    await user.dblClick(botao);

    expect(aoSalvar).toHaveBeenCalledTimes(1);
    expect(aoSalvar).toHaveBeenCalledWith(CHAVE);
    expect(screen.getByRole("button", { name: "Testando a chave…" })).toBeVisible();

    liberar();
    await waitFor(() => expect(screen.getByLabelText("Chave da API da Anthropic")).toHaveValue(""));
  });

  it("chave recusada: a mensagem da API aparece abaixo do campo, sem detalhe técnico", async () => {
    const user = userEvent.setup();
    const aoSalvar = vi.fn(async () => {
      throw new ApiError(
        400,
        "chave_invalida",
        "Chave da Anthropic inválida. Confira se copiou a chave inteira.",
      );
    });
    render(<ClaudeKeyForm aoSalvar={aoSalvar} />);

    await user.type(screen.getByLabelText("Chave da API da Anthropic"), CHAVE);
    await user.click(screen.getByRole("button", { name: "Testar e salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Chave da Anthropic inválida.");
    expect(screen.getByRole("button", { name: "Testar e salvar" })).toBeEnabled();
  });

  it("erro que não é da API: mensagem padrão, sem detalhe", async () => {
    const user = userEvent.setup();
    render(
      <ClaudeKeyForm
        aoSalvar={vi.fn(async () => {
          throw new TypeError("falha interna do navegador");
        })}
      />,
    );

    await user.type(screen.getByLabelText("Chave da API da Anthropic"), CHAVE);
    await user.click(screen.getByRole("button", { name: "Testar e salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado. Tente de novo.");
  });

  it("com Cancelar (troca dentro de um cartão), o botão aparece e chama a ação", async () => {
    const user = userEvent.setup();
    const aoCancelar = vi.fn();
    render(<ClaudeKeyForm aoSalvar={vi.fn()} aoCancelar={aoCancelar} />);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });
});
