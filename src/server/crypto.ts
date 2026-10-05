/**
 * Cifra de segredos em repouso (bloco B0).
 *
 * AES-256-GCM. Usada para os tokens OAuth de terceiros guardados em
 * `connections.access_token_enc` / `refresh_token_enc` (coluna `bytea`).
 *
 * Formato do blob: [1B versão da chave][12B IV][16B authTag][N ciphertext].
 * O byte de versão permite rotação de chave sem downtime: mantém-se a chave
 * antiga em `KEYS` para decifrar o que já existe enquanto o novo é cifrado com
 * a chave nova. Na V0 só existe a versão 1.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { env } from "@/env";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** Versão da chave usada para cifrar novos segredos. */
export const ACTIVE_KEY_VERSION = 1;

function loadKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `Chave de cifra inválida: esperados 32 bytes, obtidos ${key.length}. ` +
        `Gere com: openssl rand -base64 32`,
    );
  }
  return key;
}

const KEYS: Readonly<Record<number, Buffer>> = {
  1: loadKey(env.APP_ENCRYPTION_KEY),
};

/**
 * Cifra `plaintext` para armazenamento. Retorna um Buffer pronto para a coluna
 * `bytea`.
 */
export function encryptSecret(plaintext: string): Buffer {
  const key = KEYS[ACTIVE_KEY_VERSION];
  if (!key) {
    throw new Error(`Sem chave para a versão ${ACTIVE_KEY_VERSION}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ACTIVE_KEY_VERSION]), iv, tag, ciphertext]);
}

/**
 * Decifra um blob produzido por `encryptSecret`. Lança se o blob foi adulterado
 * (falha de autenticação GCM) ou se a versão da chave é desconhecida.
 */
export function decryptSecret(blob: Buffer): string {
  if (blob.length < HEADER_BYTES) {
    throw new Error("Blob cifrado inválido (curto demais)");
  }
  const version = blob[0]!;
  const key = KEYS[version];
  if (!key) {
    throw new Error(
      `Sem chave para a versão ${version} (rotação de chave incompleta?)`,
    );
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = blob.subarray(HEADER_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Versão da chave com que um blob foi cifrado (útil ao planejar uma rotação). */
export function keyVersionOf(blob: Buffer): number {
  if (blob.length < 1) throw new Error("Blob vazio");
  return blob[0]!;
}
