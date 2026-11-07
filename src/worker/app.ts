import { type Context, Hono } from "hono";
import type { BrandConfig } from "../shared/brand/types";
import { categoriesRoutes } from "./categories/routes";
import { createDb } from "./db/client";
import { type Meter, newMeter } from "./db/metered-d1";
import type { AppEnv } from "./env";
import { noSession, type SessionResolver } from "./household/context";
import { apiError } from "./http/errors";
import { type ValidacaoDaChave, validateClaudeKey } from "./providers/anthropic";
import { healthRoute } from "./routes/health";
import { householdRoutes } from "./routes/household";
import { settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";
import { setupGate } from "./setup/state";

export type AppOptions = {
  onMeter?: (meter: Meter, c: Context<AppEnv>) => void;
  rotasDoApp?: (app: Hono<AppEnv>) => void;
  marca?: BrandConfig;
  versao?: string;
  resolveSession?: SessionResolver;
  // Padrão: a validação real, na Anthropic. Os testes passam uma falsa; nenhum teste fala com a Anthropic.
  validateClaudeKey?: ValidacaoDaChave;
  // Relógio das rotas que precisam de "hoje" (o dia de início muda a partir do ciclo de hoje). Padrão: o relógio real.
  agora?: () => Date;
};

// Valores de desenvolvimento para os testes; a entrada de dev (index.ts) passa os do dev/marca.json.
// Sem o nome do produto: o src/worker não pode depender de dev/ (que não vai no pacote), e o aceite proíbe o literal fora de dev/.
const MARCA_DE_DESENVOLVIMENTO: BrandConfig = {
  id: "matrimoney",
  workerName: "matrimoney",
  repositorio: "confinancas/matrimoney",
  name: "App de desenvolvimento",
  shortName: "App de desenvolvimento",
  wordmark: ["App", "Dev"],
  colors: { theme: "#0E9A63", background: "#FFFFFF", wordmarkA: "#3D4943", wordmarkB: "#0E9A63" },
  texts: {
    tagline: "Ambiente de desenvolvimento.",
    assistantCta: "Pergunte ao assistente",
    householdLabel: "Conta compartilhada",
  },
};
const VERSAO_DE_DESENVOLVIMENTO = "0.1.0";

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api");
  const validar = options.validateClaudeKey ?? validateClaudeKey;

  // Primeiro middleware: mede o uso do D1 desta requisição e expõe marca e versão no contexto.
  app.use(async (c, next) => {
    const meter = newMeter();
    c.set("meter", meter);
    c.set("db", createDb(c.env.DB, meter));
    c.set("marca", options.marca ?? MARCA_DE_DESENVOLVIMENTO);
    c.set("versao", options.versao ?? VERSAO_DE_DESENVOLVIMENTO);
    await next();
    options.onMeter?.(meter, c);
  });

  // Logo depois do medidor: fora do modo pronto, só a configuração inicial responde (TASK-0102).
  app.use(setupGate());

  // As rotas do app entram antes das do núcleo, para o app poder trocar uma delas.
  options.rotasDoApp?.(app);
  app.route("/", healthRoute);
  app.route("/setup", setupRoutes(validar));
  app.route("/", settingsRoutes(validar));
  app.route("/household", householdRoutes(options.resolveSession ?? noSession, options.agora));
  app.route("/categories", categoriesRoutes(options.resolveSession ?? noSession, options.agora));

  app.notFound((c) => apiError(c, 404, "rota_inexistente", "Rota não encontrada."));

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} ${err.name}: ${err.message}`);
    return apiError(c, 500, "erro_interno", "Algo deu errado. Tente de novo.");
  });

  return app;
}
