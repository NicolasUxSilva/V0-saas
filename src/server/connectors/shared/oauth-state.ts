/**
 * `state` do OAuth 2.0 — anti-CSRF / anti-forja (G1).
 *
 * Genérico para qualquer provider OAuth. Extraído de `ga4/auth.ts` sem alteração
 * de comportamento: HMAC-SHA256 sobre `base64url(payload)` com `AUTH_SECRET`,
 * TTL de 10 minutos. O callback confere `state.workspaceId === session.workspaceId`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/env";

interface OAuthStatePayload {
  workspaceId: string;
  nonce: string;
  exp: number; // epoch ms
}

const STATE_TTL_MS = 10 * 60_000;

function hmac(body: string): Buffer {
  return createHmac("sha256", env.AUTH_SECRET).update(body).digest();
}

export function signOAuthState(data: { workspaceId: string }): string {
  const payload: OAuthStatePayload = {
    workspaceId: data.workspaceId,
    nonce: randomBytes(12).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body).toString("base64url")}`;
}

export function verifyOAuthState(state: string): { workspaceId: string } {
  const parts = state.split(".");
  if (parts.length !== 2) throw new Error("state malformado");
  const [body, sig] = parts as [string, string];

  const expected = hmac(body).toString("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("assinatura de state inválida");
  }

  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as OAuthStatePayload;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    throw new Error("state expirado");
  }
  if (!payload.workspaceId) throw new Error("state sem workspaceId");
  return { workspaceId: payload.workspaceId };
}
