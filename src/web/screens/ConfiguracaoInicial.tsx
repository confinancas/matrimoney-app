import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { brand } from "../../shared/brand";
import { ASSISTANT_AVAILABLE } from "../../shared/features";
import type { SetupMode, SetupStatus } from "../../shared/setup";
import { AccessLayout } from "../access/AccessLayout";
import { ApiError, apiEnviar, apiFetch, mensagemDoErro } from "../lib/api";
import { ClaudeKeyForm } from "../settings/ClaudeKeyForm";
import { RESTORE_ENABLED } from "../setup/restore-entry";
import { initialSetupStep } from "../setup/setup-step";

const MENSAGEM_CHAVE_MESTRA = "A instalação está incompleta: rode npm run instalar de novo no computador.";
const PREFIXO_DO_CODIGO = "#codigo=";

type RespostaDoCodigo = { mode: SetupMode; unlocked: boolean };
type RespostaDaChave = { claude: { masked: string | null }; mode: SetupMode };

// O código do QR code vem no fragmento (#codigo=…). Some da barra de endereço antes de qualquer outra coisa.
function tiraCodigoDoFragmento(): string | null {
  if (!window.location.hash.startsWith(PREFIXO_DO_CODIGO)) return null;
  const bruto = window.location.hash.slice(PREFIXO_DO_CODIGO.length);
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  try {
    return decodeURIComponent(bruto) || null;
  } catch {
    return bruto || null;
  }
}

// Configuração inicial (/configuracao-inicial): código de primeiro acesso, chave da IA e "como começar".
export function ConfiguracaoInicial() {
  const navegar = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [falha, setFalha] = useState<ApiError | null>(null);
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [codigo, setCodigo] = useState("");
  const [erroDoCodigo, setErroDoCodigo] = useState<string | null>(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [mascarada, setMascarada] = useState<string | null>(null);
  const [semIa, setSemIa] = useState(false);
  const [confirmandoSemIa, setConfirmandoSemIa] = useState(false);
  const [enviandoSemIa, setEnviandoSemIa] = useState(false);
  const [erroSemIa, setErroSemIa] = useState<string | null>(null);
  const [assistente, setAssistente] = useState(false);

  // Cada envio tem a sua trava: dois toques antes do re-render não viram duas chamadas.
  const iniciou = useRef(false);
  const travaDoCodigo = useRef(false);
  const travaDoSemIa = useRef(false);

  const carregar = useCallback(
    async (codigoDoLink: string | null) => {
      try {
        let estado = await apiFetch<SetupStatus>("/api/setup/status");
        if (estado.mode === "pronto") {
          navegar("/entrar", { replace: true });
          return;
        }
        if (codigoDoLink && !estado.unlocked) {
          setCodigo(codigoDoLink);
          try {
            const resposta = await apiEnviar<RespostaDoCodigo>("/api/setup/unlock", "POST", {
              code: codigoDoLink,
            });
            estado = { ...estado, mode: resposta.mode, unlocked: true };
          } catch (erro) {
            setErroDoCodigo(mensagemDoErro(erro));
          }
        }
        setStatus(estado);
        const inicio = initialSetupStep(estado);
        if (inicio !== "entrar") setPasso(inicio);
      } catch (erro) {
        setFalha(erro instanceof ApiError ? erro : new ApiError(0, "erro_http", mensagemDoErro(erro)));
      }
    },
    [navegar],
  );

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    // Primeiro o fragmento: a URL não guarda o código depois desta linha.
    const codigoDoLink = tiraCodigoDoFragmento();
    void carregar(codigoDoLink);
  }, [carregar]);

  async function enviarCodigo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (travaDoCodigo.current) return;
    travaDoCodigo.current = true;
    setEnviandoCodigo(true);
    setErroDoCodigo(null);
    try {
      const resposta = await apiEnviar<RespostaDoCodigo>("/api/setup/unlock", "POST", { code: codigo });
      setPasso(resposta.mode === "cadastro" ? 3 : 2);
    } catch (erro) {
      setErroDoCodigo(mensagemDoErro(erro));
    } finally {
      travaDoCodigo.current = false;
      setEnviandoCodigo(false);
    }
  }

  async function salvarChave(chave: string) {
    const resposta = await apiEnviar<RespostaDaChave>("/api/setup/keys/claude", "POST", {
      apiKey: chave,
      assistente,
    });
    setMascarada(resposta.claude.masked);
    setSemIa(false);
    setPasso(3);
  }

  async function continuarSemIa() {
    if (travaDoSemIa.current) return;
    travaDoSemIa.current = true;
    setEnviandoSemIa(true);
    setErroSemIa(null);
    try {
      await apiFetch<{ mode: SetupMode }>("/api/setup/skip-ai", { method: "POST" });
      setSemIa(true);
      setConfirmandoSemIa(false);
      setPasso(3);
    } catch (erro) {
      setErroSemIa(mensagemDoErro(erro));
    } finally {
      travaDoSemIa.current = false;
      setEnviandoSemIa(false);
    }
  }

  if (falha) {
    return (
      <AccessLayout>
        <ErrorState
          offline={falha.code === "sem_conexao"}
          onRetry={() => {
            setFalha(null);
            void carregar(null);
          }}
        />
      </AccessLayout>
    );
  }

  if (!status) {
    return (
      <AccessLayout>
        <div aria-hidden="true" className="mm-esqueleto h-40 rounded-card" />
      </AccessLayout>
    );
  }

  if (!status.masterKeyOk) {
    return (
      <AccessLayout>
        <Card role="alert" className="flex flex-col gap-3">
          <h1 className="text-[20px] font-extrabold">Não dá para continuar</h1>
          <p className="text-[14px] text-ink-2">{MENSAGEM_CHAVE_MESTRA}</p>
        </Card>
      </AccessLayout>
    );
  }

  if (passo === 1) {
    return (
      <AccessLayout steps={{ current: 1, total: 3, label: "Código" }}>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Configuração inicial</h1>
            <p className="text-[14px] leading-normal text-ink-2">
              Digite o código que apareceu no terminal quando você rodou o script de instalação.
            </p>
          </div>
          <form onSubmit={enviarCodigo} className="flex flex-col gap-5" noValidate>
            <TextField
              label="Código de primeiro acesso"
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              value={codigo}
              onChange={(evento) => setCodigo(evento.target.value)}
              error={erroDoCodigo ?? undefined}
              className="uppercase"
            />
            <Button type="submit" full loading={enviandoCodigo}>
              Continuar
            </Button>
          </form>
        </Card>
      </AccessLayout>
    );
  }

  if (passo === 2) {
    return (
      <AccessLayout steps={{ current: 2, total: 3, label: "Chave do Claude" }}>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Conecte a IA</h1>
            <p className="text-[14px] leading-normal text-ink-2">
              {brand.name} usa o Claude, da Anthropic, para categorizar as transações. A chave é sua: crie em
              console.anthropic.com › API Keys, de preferência com um limite de gasto.
            </p>
          </div>
          <ClaudeKeyForm aoSalvar={salvarChave} />
          {ASSISTANT_AVAILABLE && (
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">Assistente de IA</span>
                <span className="text-[13px] text-ink-2">
                  Conversa sobre o dinheiro de vocês. Usa a mesma chave e gasta mais.
                </span>
              </div>
              <Switch checked={assistente} onCheckedChange={setAssistente} label="Assistente de IA" />
            </div>
          )}
          {confirmandoSemIa ? (
            <div className="flex flex-col gap-3 rounded-card bg-field p-4">
              <h2 className="text-[16px] font-extrabold">Continuar sem IA?</h2>
              <p className="text-[14px] leading-normal text-ink-2">
                Vocês escolhem a categoria de cada gasto novo, e os meses antigos ficam sem categoria. O app
                continua calculando tudo. Dá para colar a chave depois, em Configurações.
              </p>
              {erroSemIa && (
                <p role="alert" className="text-[13px] text-danger">
                  {erroSemIa}
                </p>
              )}
              <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmandoSemIa(false)}
                  disabled={enviandoSemIa}
                >
                  Voltar
                </Button>
                <Button onClick={continuarSemIa} loading={enviandoSemIa}>
                  Continuar sem IA
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" full onClick={() => setConfirmandoSemIa(true)}>
              Continuar sem IA
            </Button>
          )}
        </Card>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout steps={{ current: 3, total: 3, label: "Como começar" }} sobreposto={false}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Tudo pronto para começar</h1>
        <p className="text-[14px] leading-normal text-ink-2">
          {mascarada
            ? `Chave salva: ${mascarada}`
            : semIa
              ? "Sem IA por enquanto. Dá para colar a chave em Configurações."
              : "Configuração salva. Dá para conferir a IA em Configurações."}
        </p>
      </div>
      <Link to="/criar-conta" className="block no-underline">
        <Card className="flex flex-col gap-1 transition-colors hover:bg-primary-soft">
          <span className="text-[16px] font-extrabold text-ink">Começar do zero</span>
          <span className="text-[14px] text-ink-2">Criar a conta do casal agora.</span>
        </Card>
      </Link>
      {RESTORE_ENABLED && (
        <Link to="/restaurar" className="block no-underline">
          <Card className="flex flex-col gap-1">
            <span className="text-[16px] font-extrabold text-ink">Restaurar um backup</span>
            <span className="text-[14px] text-ink-2">
              Trazer os dados de um arquivo .sql.enc de outra instalação.
            </span>
          </Card>
        </Link>
      )}
    </AccessLayout>
  );
}
