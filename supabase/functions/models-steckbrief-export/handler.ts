import { isRecord } from "../_shared/steckbrief/core.ts";
import { validateExportEnvelope } from "../_shared/steckbrief/contracts.ts";
import {
  constantTimeSecretEqual,
  jsonResponse,
  loggedHandler,
} from "../_shared/steckbrief/http.ts";
import type { RuntimeDeps } from "../_shared/steckbrief/http.ts";
import {
  inventoryRequest,
  loadInventory,
} from "../_shared/steckbrief/inventory.ts";
import type { InventoryStore } from "../_shared/steckbrief/inventory.ts";
import { resolveAccounts } from "../_shared/steckbrief/resolution.ts";
import { ShexClient } from "../_shared/steckbrief/shex-client.ts";
import type {
  ExportEnvelope,
  ExportSummary,
} from "../_shared/steckbrief/types.ts";

export interface ExportHandlerDeps extends RuntimeDeps {
  store: InventoryStore;
}

function validPlatform(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 32;
}

export function createExportHandler(
  deps: ExportHandlerDeps,
): (request: Request) => Promise<Response> {
  return loggedHandler(
    "models-steckbrief-export",
    deps,
    {
      accounts: 0,
      approved: 0,
      not_approved: 0,
      missing: 0,
      excluded_rows: 0,
    },
    {},
    async (request, context) => {
      if (request.method !== "GET" && request.method !== "POST") {
        return context
          .fail(405, "method_not_allowed");
      }
      const exportKey = deps.env("STECKBRIEF_EXPORT_KEY")?.trim();
      if (!exportKey) return context.fail(503, "not_configured");
      const provided = request.headers.get("x-api-key")?.trim();
      if (
        !provided || !await constantTimeSecretEqual(provided, exportKey)
      ) return context.fail(401, "unauthorized");
      const upstreamKey = deps.env("CONTROLLING_MODEL_PROFILES_KEY")?.trim();
      if (!upstreamKey) return context.fail(503, "not_configured");
      const generatedAt = deps.now().toISOString();

      const queryPlatforms = new URL(request.url).searchParams.getAll(
        "platform",
      );
      if (
        queryPlatforms.length > 1 ||
        queryPlatforms.some((value) => !validPlatform(value))
      ) return context.fail(400, "invalid_request");
      let platform = queryPlatforms[0];
      // Like models-export, an empty POST body means "no filter".
      const text = request.method === "POST" ? await request.text() : "";
      if (text.trim() !== "") {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return context.fail(400, "invalid_request");
        }
        if (!isRecord(body)) return context.fail(400, "invalid_request");
        if (Object.hasOwn(body, "platform")) {
          if (!validPlatform(body.platform)) {
            return context.fail(
              400,
              "invalid_request",
            );
          }
          // Match the existing export's precedence when both locations are supplied.
          platform = body.platform;
        }
      }

      const inventory = await loadInventory(deps.store);
      const client = new ShexClient({
        apiKey: upstreamKey,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
      });
      const upstream = await client.resolve(inventoryRequest(inventory, true));
      const allAccounts = resolveAccounts(
        inventory.models,
        inventory.links,
        upstream,
      );
      const matches = (value: string) =>
        platform === undefined ||
        value.toLowerCase() === platform.toLowerCase();
      const accounts = allAccounts.filter((account) =>
        matches(account.platform)
      );
      const summary: ExportSummary = {
        accounts: accounts.length,
        approved: 0,
        not_approved: 0,
        missing: 0,
        excluded_rows:
          inventory.excludedModels.filter((model) => matches(model.platform))
            .length,
      };
      for (const account of accounts) summary[account.status]++;
      const envelope: ExportEnvelope = {
        contract: "models-steckbrief-export.v1",
        generated_at: generatedAt,
        summary,
        accounts,
      };
      validateExportEnvelope(envelope);
      context.counts = { ...summary };
      return jsonResponse(envelope);
    },
  );
}
