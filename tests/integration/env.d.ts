import type { D1Migration } from "@cloudflare/vitest-plugin";

// Os bindings que o plugin entrega aos testes (cloudflare:test): o D1 do núcleo e as migrações aplicadas no setup.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      MASTER_KEY: string;
      ANTHROPIC_BASE_URL?: string;
    }
  }
}
