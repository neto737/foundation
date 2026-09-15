const TURNSTILE_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerification {
  "success": boolean;
  "challenge_ts"?: string;
  "hostname"?: string;
  "error-codes"?: string[];
  "action"?: string;
  "cdata"?: string;
}

export interface VerifyTurnstileOptions {
  secret: string;
  token: string;
  remoteIp?: string;
  idempotencyKey?: string;
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
}

export async function verifyTurnstile(
  options: VerifyTurnstileOptions,
): Promise<TurnstileVerification> {
  const body = new URLSearchParams({
    response: options.token,
    secret: options.secret,
  });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);
  if (options.idempotencyKey)
    body.set("idempotency_key", options.idempotencyKey);

  const response = await (options.fetch ?? globalThis.fetch)(
    options.endpoint ?? TURNSTILE_ENDPOINT,
    {
      body,
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Turnstile verification failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as TurnstileVerification;
}
