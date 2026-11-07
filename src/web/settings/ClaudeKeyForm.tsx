import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "../lib/api";
import { avisoDeTipoDaChave } from "./chave-da-ia";

type Props = {
  // A tela chama a API e lança ApiError se a chave for recusada. Nada é gravado nesse caso.
  aoSalvar: (chave: string) => Promise<void>;
  // Cancelar aparece quando a troca abre dentro de um cartão que já tem chave.
  aoCancelar?: () => void;
  // A chave fica só no campo; ao salvar, o campo é esvaziado.
};

const MENSAGEM_PADRAO = "Algo deu errado. Tente de novo.";

// Campo da chave da IA: senha com Mostrar/Ocultar (como no Login), aviso de tipo, um envio por vez.
export function ClaudeKeyForm({ aoSalvar, aoCancelar }: Props) {
  const campoId = useId();
  const [valor, setValor] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Espelha o envio em andamento: dois cliques antes do re-render não mandam duas chamadas.
  const enviando = useRef(false);

  const aviso = avisoDeTipoDaChave(valor);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando.current) return;
    const chave = valor.trim();
    enviando.current = true;
    setTestando(true);
    setErro(null);
    try {
      await aoSalvar(chave);
      setValor("");
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : MENSAGEM_PADRAO);
    } finally {
      enviando.current = false;
      setTestando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor={campoId} className="text-[13px] text-ink-2">
          Chave da API da Anthropic
        </label>
        <div className="relative">
          <input
            id={campoId}
            type={mostrar ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
            aria-invalid={erro ? true : undefined}
            aria-describedby={`${campoId}-ajuda`}
            placeholder="sk-ant-api..."
            className="h-[52px] w-full rounded-field border border-field-border bg-field pr-[92px] pl-4 text-[16px] text-ink outline-none transition-colors placeholder:text-hidden-ink focus:border-primary focus:ring-[3px] focus:ring-primary/14"
          />
          <button
            type="button"
            onClick={() => setMostrar((atual) => !atual)}
            className="absolute top-1 right-1 flex h-11 items-center rounded-[12px] px-3.5 text-[13px] font-semibold text-primary"
          >
            {mostrar ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        <p id={`${campoId}-ajuda`} className="text-[13px] text-ink-2">
          Fica guardada cifrada no seu servidor e nunca mais aparece inteira.
        </p>
        {aviso && <p className="text-[13px] text-warn">{aviso}</p>}
        {erro && (
          <p role="alert" className="text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
        {aoCancelar && (
          <Button variant="secondary" onClick={aoCancelar} disabled={testando}>
            Cancelar
          </Button>
        )}
        <Button type="submit" full loading={testando} disabled={valor.trim() === "" && !testando}>
          {testando ? "Testando a chave…" : "Testar e salvar"}
        </Button>
      </div>
    </form>
  );
}
