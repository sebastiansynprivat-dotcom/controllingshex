import { identityKey } from "./core.ts";
import {
  validateModelsResponse,
  validateResolveRequest,
  validateResolveResponse,
} from "./contracts.ts";
import { UpstreamError } from "./errors.ts";
import type {
  Resolution,
  ResolveRequest,
  ResolveResponse,
  ShexModel,
  ShexProfile,
} from "./types.ts";

export const SHEX_URL =
  "https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-model-profiles";
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const ATTEMPT_TIMEOUT_MS = 20_000;
export const RETRY_DELAY_MS = 1000;

export interface ShexClientDeps {
  apiKey: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Only tests override the production per-attempt deadline. */
  timeoutMs?: number;
}

type Attempt = { ok: true; value: unknown } | { ok: false; retryable: boolean };

function cancel(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}

async function boundedBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const declaredSize = response.headers.get("content-length");
  if (declaredSize !== null && Number(declaredSize) > MAX_RESPONSE_BYTES) {
    cancel(response.body);
    throw new UpstreamError();
  }
  if (!response.body) throw new UpstreamError();
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const part = await reader.read();
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new UpstreamError();
      }
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// JSON object key order is irrelevant when the same model appears in two chunks.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null || b === null || typeof a !== "object" || typeof b !== "object"
  ) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) =>
      Object.hasOwn(right, key) && sameJson(left[key], right[key])
    );
}

export class ShexClient {
  constructor(private readonly deps: ShexClientDeps) {}

  private async attempt(body: string): Promise<Attempt> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Attempt>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, retryable: true });
      }, this.deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
    });
    const transport = async (): Promise<Attempt> => {
      try {
        const response = await this.deps.fetchImpl(SHEX_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.deps.apiKey,
          },
          body,
          signal: controller.signal,
          // Inspect redirects as non-200 responses without forwarding the key.
          redirect: "manual",
        });
        if (controller.signal.aborted) {
          cancel(response.body);
          return { ok: false, retryable: true };
        }
        if (response.status !== 200) {
          cancel(response.body);
          return {
            ok: false,
            retryable: response.status === 429 ||
              (response.status >= 500 && response.status <= 599),
          };
        }
        if (
          response.headers.get("content-type")?.split(";")[0].trim()
            .toLowerCase() !== "application/json"
        ) {
          cancel(response.body);
          return { ok: false, retryable: false };
        }
        const text = await boundedBody(response, controller.signal);
        try {
          return { ok: true, value: JSON.parse(text) };
        } catch {
          return { ok: false, retryable: false };
        }
      } catch (error) {
        return { ok: false, retryable: !(error instanceof UpstreamError) };
      }
    };
    try {
      return await Promise.race([transport(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    body: unknown,
    validate: (value: unknown) => T,
  ): Promise<T> {
    try {
      const encoded = JSON.stringify(body);
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.attempt(encoded);
        if (result.ok) return validate(result.value);
        if (!result.retryable || attempt === 1) throw new UpstreamError();
        await this.deps.sleep(RETRY_DELAY_MS);
      }
    } catch {
      throw new UpstreamError();
    }
    throw new UpstreamError();
  }

  async resolve(request: ResolveRequest): Promise<ResolveResponse> {
    const resolutions: Resolution[] = [];
    const profiles = new Map<string, ShexProfile>();
    const echoes = new Map<string, Resolution>();
    const calls = Math.max(
      1,
      Math.ceil(request.identities.length / 1000),
      Math.ceil(request.model_ids.length / 1000),
    );
    for (let i = 0; i < calls; i++) {
      const chunk: ResolveRequest = {
        identities: request.identities.slice(i * 1000, (i + 1) * 1000),
        model_ids: request.model_ids.slice(i * 1000, (i + 1) * 1000),
        include_profiles: request.include_profiles,
      };
      validateResolveRequest(chunk);
      const response = await this.request(
        { action: "resolve", ...chunk },
        (value) => validateResolveResponse(value, chunk),
      );
      for (const row of response.resolutions) {
        const key = identityKey(row.platform, row.email);
        const previous = echoes.get(key);
        if (previous && !sameJson(previous, row)) throw new UpstreamError();
        echoes.set(key, row);
        resolutions.push(row);
      }
      for (const profile of response.profiles) {
        const previous = profiles.get(profile.model_id);
        if (previous && !sameJson(previous, profile)) throw new UpstreamError();
        profiles.set(profile.model_id, profile);
      }
    }
    return {
      contract: "controlling-model-profiles.v1",
      resolutions,
      profiles: [...profiles.values()].sort((a, b) =>
        a.model_id.localeCompare(b.model_id)
      ),
    };
  }

  async listModels(): Promise<ShexModel[]> {
    return (await this.request(
      { action: "list_models" },
      validateModelsResponse,
    )).models;
  }
}
