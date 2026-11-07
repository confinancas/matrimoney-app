// Cifra das chaves no banco (ADR-004): AES-GCM com a chave mestra MASTER_KEY (base64 de 32 bytes).
// Só WebCrypto, para rodar no Worker e no Node 22. O nome do segredo entra como additionalData:
// uma linha copiada para outro nome não abre. Cada gravação tem um IV novo.

const BYTES_DA_CHAVE = 32;
const BYTES_DO_IV = 12;
const codificador = new TextEncoder();

// Ausente ou com tamanho errado. As rotas que cifram ou decifram respondem chave_mestra_ausente.
export class ChaveMestraAusenteError extends Error {
  constructor() {
    super("Chave mestra ausente ou inválida.");
    this.name = "ChaveMestraAusenteError";
  }
}

type ChaveImportada = { base64: string; chave: Promise<CryptoKey> };
let cache: ChaveImportada | null = null;

function decodificaBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function codificaBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function chaveMestraValida(mestra: string | undefined): boolean {
  if (!mestra) return false;
  try {
    return decodificaBase64(mestra).length === BYTES_DA_CHAVE;
  } catch {
    return false;
  }
}

// Importa a chave uma vez por valor. Se a chave mestra mudar (outro teste, outro secret), importa de novo.
function chaveDeCifra(mestra: string | undefined): Promise<CryptoKey> {
  if (!mestra || !chaveMestraValida(mestra)) return Promise.reject(new ChaveMestraAusenteError());
  if (cache?.base64 !== mestra) {
    cache = {
      base64: mestra,
      chave: crypto.subtle.importKey("raw", decodificaBase64(mestra), "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]),
    };
  }
  return cache.chave;
}

export type SegredoCifrado = { ciphertext: string; iv: string };

export async function encryptSecret(
  mestra: string | undefined,
  nome: string,
  texto: string,
): Promise<SegredoCifrado> {
  const chave = await chaveDeCifra(mestra);
  const iv = crypto.getRandomValues(new Uint8Array(BYTES_DO_IV));
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: codificador.encode(nome) },
    chave,
    codificador.encode(texto),
  );
  return { ciphertext: codificaBase64(new Uint8Array(cifrado)), iv: codificaBase64(iv) };
}

// Lança se a chave mestra não confere, se a linha foi adulterada ou se o nome é outro.
// Quem chama decide o que fazer (readSecret devolve "ilegivel"; nunca mostra o motivo).
export async function decryptSecret(
  mestra: string | undefined,
  nome: string,
  segredo: SegredoCifrado,
): Promise<string> {
  const chave = await chaveDeCifra(mestra);
  const aberto = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodificaBase64(segredo.iv), additionalData: codificador.encode(nome) },
    chave,
    decodificaBase64(segredo.ciphertext),
  );
  return new TextDecoder().decode(aberto);
}

// Só para os testes: esquece a chave importada.
export function resetCryptoCacheForTests(): void {
  cache = null;
}
