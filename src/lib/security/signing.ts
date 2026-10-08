import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 signatures for demo sessions and demo media links. */
export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function signExpiring(secret: string, purpose: string, value: string, ttlSeconds: number, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return { exp, sig: sign(secret, `${purpose}|${value}|${exp}`) };
}

export function verifyExpiring(secret: string, purpose: string, value: string, exp: number, sig: string, nowMs = Date.now()): boolean {
  if (!Number.isSafeInteger(exp) || exp < Math.floor(nowMs / 1000)) return false;
  return verifySignature(secret, `${purpose}|${value}|${exp}`, sig);
}
