import { isRecord } from "../_shared/steckbrief/core.ts";
import {
  jsonResponse,
  LINKS_CORS_HEADERS,
  loggedHandler,
} from "../_shared/steckbrief/http.ts";
import type { RuntimeDeps } from "../_shared/steckbrief/http.ts";
import {
  inventoryRequest,
  loadInventory,
} from "../_shared/steckbrief/inventory.ts";
import type {
  AuthStore,
  InventoryStore,
} from "../_shared/steckbrief/inventory.ts";
import { buildOverview } from "../_shared/steckbrief/overview.ts";
import { ShexClient } from "../_shared/steckbrief/shex-client.ts";

export interface LinksHandlerDeps extends RuntimeDeps {
  store: InventoryStore & AuthStore;
}

export function createLinksHandler(
  deps: LinksHandlerDeps,
): (request: Request) => Promise<Response> {
  return loggedHandler(
    "steckbrief-links",
    deps,
    {
      models: 0,
      identities: 0,
      orphan_overrides: 0,
      excluded_rows: 0,
    },
    LINKS_CORS_HEADERS,
    async (request, context) => {
      if (request.method === "OPTIONS") {
        return new Response("ok", {
          headers: LINKS_CORS_HEADERS,
        });
      }
      if (request.method !== "POST") {
        return context.fail(
          405,
          "method_not_allowed",
        );
      }
      const token = /^Bearer\s+(\S+)$/i.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token) return context.fail(401, "unauthorized");
      const userId = await deps.store.getUserIdFromToken(token);
      if (!userId) return context.fail(401, "unauthorized");
      if (!await deps.store.isAdmin(userId)) {
        return context.fail(
          403,
          "forbidden",
        );
      }
      const upstreamKey = deps.env("CONTROLLING_MODEL_PROFILES_KEY")?.trim();
      if (!upstreamKey) return context.fail(503, "not_configured");
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return context.fail(400, "invalid_request");
      }
      if (!isRecord(body) || body.action !== "overview") {
        return context.fail(
          400,
          "invalid_request",
        );
      }

      const inventory = await loadInventory(deps.store);
      const client = new ShexClient({
        apiKey: upstreamKey,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
      });
      // Finish both calls before logging/returning, including when one fails.
      const [resolved, listed] = await Promise.allSettled([
        client.resolve(inventoryRequest(inventory, false)),
        client.listModels(),
      ]);
      if (resolved.status === "rejected") throw resolved.reason;
      if (listed.status === "rejected") throw listed.reason;
      const envelope = buildOverview(
        inventory,
        resolved.value,
        listed.value,
        deps.now().toISOString(),
      );
      context.counts = {
        models: envelope.models.length,
        identities: envelope.identities.length,
        orphan_overrides: envelope.orphan_overrides.length,
        excluded_rows: envelope.excluded_rows,
      };
      return jsonResponse(envelope, 200, LINKS_CORS_HEADERS);
    },
  );
}
