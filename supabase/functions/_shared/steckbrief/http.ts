import { classifyError } from "./errors.ts";
import type { ErrorCode } from "./errors.ts";

export const LINKS_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
} as const;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export async function constantTimeSecretEqual(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export interface RuntimeDeps {
  env: (name: string) => string | undefined;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  log: (line: string) => void;
}

interface RequestContext {
  counts: Record<string, number>;
  fail: (status: number, code: ErrorCode) => Response;
}

/** The only logging boundary: neither exceptions nor request/response data are logged. */
export function loggedHandler(
  fn: string,
  deps: Pick<RuntimeDeps, "now" | "log">,
  initialCounts: Record<string, number>,
  headers: HeadersInit,
  work: (request: Request, context: RequestContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const start = deps.now().getTime();
    let code: ErrorCode | undefined;
    const context: RequestContext = {
      counts: { ...initialCounts },
      fail: (status, error) => {
        code = error;
        return jsonResponse({ error }, status, headers);
      },
    };
    let response: Response;
    try {
      response = await work(request, context);
    } catch (error) {
      const failure = classifyError(error);
      response = context.fail(failure.status, failure.code);
    }
    deps.log(JSON.stringify({
      fn,
      status: response.status,
      counts: context.counts,
      ms: Math.max(0, deps.now().getTime() - start),
      ...(code ? { error: code } : {}),
    }));
    return response;
  };
}
