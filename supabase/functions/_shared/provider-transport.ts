export const PROVIDER_TIMEOUT_MS = 15000;
export function providerRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds)
    ? Math.min(3600, Math.max(0, Math.ceil(seconds)))
    : null;
}
export async function sendProviderEmail(
  env: Record<string, string | undefined>,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error("provider_timeout"));
    }, deps.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await (deps.fetch ?? fetch)(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${env.RESEND_API_KEY}`,
              "content-type": "application/json",
              "idempotency-key": idempotencyKey,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        // Keep the timeout active through body consumption, not only headers.
        const reader = response.body?.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              throw Error("provider_response_invalid");
            }
            chunks.push(value);
          }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return new Response(response.status === 204 ? null : bytes, {
          status: response.status,
          headers: {
            "content-type": "application/json",
            ...(response.headers.has("retry-after")
              ? { "retry-after": response.headers.get("retry-after")! }
              : {}),
          },
        });
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
