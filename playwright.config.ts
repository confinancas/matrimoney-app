import { defineConfig } from "@playwright/test";

// Só Chromium. O servidor do E2E (scripts/dev/e2e-server.mjs) sobe sozinho: a porta 8788 (instalação pronta) e a
// 8790 (configuração inicial do zero, nos testes de configuracao-inicial.spec.ts). Um worker só: os testes mudam o
// estado do D1 local, e os dois projetos compartilham a instalação pronta.
export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:8788", trace: "on-first-retry" },
  webServer: {
    command: "npm run e2e:server",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "celular", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
