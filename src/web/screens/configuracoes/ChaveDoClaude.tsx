import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { ASSISTANT_AVAILABLE } from "../../../shared/features";
import type { KeyStatus, KeysResponse } from "../../../shared/setup";
import { useFeatures } from "../../app/features";
import { ApiError, apiEnviar, apiFetch, mensagemDoErro } from "../../lib/api";
import { ClaudeKeyForm } from "../../settings/ClaudeKeyForm";

const MENSAGEM_CHAVE_MESTRA = "A instalação está incompleta: rode npm run instalar de novo no computador.";

type Props = { assistenteDisponivel?: boolean };

// Claude e assistente (/configuracoes/claude): a chave mascarada, a troca, e o liga/desliga do assistente.
export function ChaveDoClaude({ assistenteDisponivel = ASSISTANT_AVAILABLE }: Props) {
  const funcoes = useFeatures();
  const [chaves, setChaves] = useState<KeysResponse | null>(null);
  const [falha, setFalha] = useState<ApiError | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [assistente, setAssistente] = useState(funcoes.assistente);
  const [erroDoAssistente, setErroDoAssistente] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setFalha(null);
    apiFetch<KeysResponse>("/api/settings/keys").then(setChaves, (erro: unknown) => {
      setFalha(erro instanceof ApiError ? erro : new ApiError(0, "erro_http", mensagemDoErro(erro)));
    });
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarChave(chave: string) {
    const anterior = chaves?.claude;
    const resposta = await apiEnviar<{ claude: KeyStatus }>("/api/settings/keys/claude", "PUT", {
      apiKey: chave,
    });
    setChaves((atual) => (atual ? { ...atual, claude: resposta.claude } : atual));
    setTrocando(false);
    setMensagem(
      anterior?.configured
        ? "Chave trocada."
        : "Chave salva. A IA começa a sugerir em alguns minutos, inclusive nos meses antigos.",
    );
  }

  async function mudarAssistente(ligar: boolean) {
    const antes = assistente;
    setAssistente(ligar);
    setErroDoAssistente(null);
    try {
      const resposta = await apiEnviar<{ assistente: boolean }>("/api/features/assistente", "PUT", {
        enabled: ligar,
      });
      setAssistente(resposta.assistente);
    } catch {
      setAssistente(antes);
      setErroDoAssistente("Não deu para salvar agora. Tente de novo.");
    }
  }

  return (
    <>
      <GreenTop
        variant="detail"
        title="Claude e assistente"
        back={{ to: "/configuracoes", label: "Voltar" }}
        overlap
      />
      <div className="px-4 tablet:px-6">
        <div className="mx-auto flex max-w-[640px] flex-col gap-4">
          {falha ? (
            falha.code === "chave_mestra_ausente" ? (
              <Card overlap role="alert">
                <p className="text-[14px] text-ink-2">{MENSAGEM_CHAVE_MESTRA}</p>
              </Card>
            ) : (
              <ErrorState onRetry={carregar} />
            )
          ) : !chaves ? (
            <div aria-hidden="true" className="mm-esqueleto -mt-11 h-40 rounded-card" />
          ) : (
            <CartaoDaChave
              chave={chaves.claude}
              trocando={trocando}
              mensagem={mensagem}
              onTrocar={() => {
                setMensagem(null);
                setTrocando(true);
              }}
              onCancelar={() => setTrocando(false)}
              onSalvar={salvarChave}
            />
          )}

          {assistenteDisponivel && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[16px] font-extrabold">Assistente de IA</span>
                  <span className="text-[14px] text-ink-2">
                    Conversa sobre o dinheiro de vocês. Usa a mesma chave e gasta mais.
                  </span>
                </div>
                <Switch checked={assistente} onCheckedChange={mudarAssistente} label="Assistente de IA" />
              </div>
              {erroDoAssistente && (
                <p role="alert" className="text-[13px] text-danger">
                  {erroDoAssistente}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

type CartaoProps = {
  chave: KeyStatus;
  trocando: boolean;
  mensagem: string | null;
  onTrocar: () => void;
  onCancelar: () => void;
  onSalvar: (chave: string) => Promise<void>;
};

// Sem chave: "Sem IA" e o formulário aberto. Com chave que abre: "Conectada" e o mascarado. Com chave que não abre: "Não abre mais".
function CartaoDaChave({ chave, trocando, mensagem, onTrocar, onCancelar, onSalvar }: CartaoProps) {
  const formularioAberto = !chave.configured || trocando;

  return (
    <Card overlap className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-extrabold">Chave da API da Anthropic</h2>
        {!chave.configured ? (
          <StatusPill tone="aviso">Sem IA</StatusPill>
        ) : chave.readable ? (
          <StatusPill tone="sucesso">Conectada</StatusPill>
        ) : (
          <StatusPill tone="falta">Não abre mais</StatusPill>
        )}
      </div>

      {!chave.configured && (
        <p className="text-[14px] leading-normal text-ink-2">
          Sem a chave, vocês escolhem a categoria de cada gasto, e o app não tem assistente nem resumo do mês.
        </p>
      )}

      {chave.configured && (
        <div className="flex flex-col gap-2">
          {chave.readable ? (
            <span className="text-[15px] font-semibold text-ink">{chave.masked}</span>
          ) : (
            <p className="text-[14px] leading-normal text-ink-2">
              A chave não abre nesta instalação (a chave mestra mudou). Cole a chave de novo.
            </p>
          )}
          {!trocando && (
            <Button variant="secondary" className="self-start" onClick={onTrocar}>
              Trocar chave
            </Button>
          )}
        </div>
      )}

      {formularioAberto && (
        <ClaudeKeyForm aoSalvar={onSalvar} aoCancelar={chave.configured ? onCancelar : undefined} />
      )}

      {mensagem && (
        <p role="status" className="text-[14px] font-semibold text-success-ink">
          {mensagem}
        </p>
      )}
    </Card>
  );
}
