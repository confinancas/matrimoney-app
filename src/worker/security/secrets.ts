// Contrato de segredos (TASK-0102), usado pelas outras tasks: TASK-0203 (Meu Pluggy), 0303, 0501, 0601.
// Quem lê nunca loga, devolve ou grava o valor. Nomes: claude_api_key, google_tts_key.
import { eq } from "drizzle-orm";
import type { KeyStatus } from "../../shared/setup";
import type { Db } from "../db/client";
import { appSecrets } from "../db/schema";
import type { Env } from "../env";
import { decryptSecret, encryptSecret } from "./crypto";
import { maskKey } from "./mascara";

export { maskKey };

export type LeituraDoSegredo =
  | { status: "ok"; value: string }
  | { status: "ausente" }
  | { status: "ilegivel" };

export async function saveSecret(db: Db, env: Env, nome: string, valor: string): Promise<void> {
  const { ciphertext, iv } = await encryptSecret(env.MASTER_KEY, nome, valor);
  const atualizadoEm = new Date().toISOString();
  await db
    .insert(appSecrets)
    .values({ name: nome, ciphertext, iv, updatedAt: atualizadoEm })
    .onConflictDoUpdate({ target: appSecrets.name, set: { ciphertext, iv, updatedAt: atualizadoEm } });
}

// Nunca lança por causa da cifra: chave mestra trocada, chave ausente ou linha adulterada viram "ilegivel".
export async function readSecret(db: Db, env: Env, nome: string): Promise<LeituraDoSegredo> {
  const [linha] = await db.select().from(appSecrets).where(eq(appSecrets.name, nome)).limit(1);
  if (!linha) return { status: "ausente" };
  try {
    const value = await decryptSecret(env.MASTER_KEY, nome, { ciphertext: linha.ciphertext, iv: linha.iv });
    return { status: "ok", value };
  } catch {
    return { status: "ilegivel" };
  }
}

export async function secretStatus(db: Db, env: Env, nome: string): Promise<KeyStatus> {
  const leitura = await readSecret(db, env, nome);
  if (leitura.status === "ausente") return { configured: false, masked: null, readable: false };
  if (leitura.status === "ilegivel") return { configured: true, masked: null, readable: false };
  return { configured: true, masked: maskKey(leitura.value), readable: true };
}
