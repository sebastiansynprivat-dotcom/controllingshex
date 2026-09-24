// These constructors deliberately accept no upstream or database error text.
export class UpstreamError extends Error {
  constructor() {
    super("upstream_failed");
    this.name = "UpstreamError";
  }
}

export class InventoryIncompleteError extends Error {
  constructor() {
    super("inventory_incomplete");
    this.name = "InventoryIncompleteError";
  }
}

export type ErrorCode =
  | "method_not_allowed"
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "upstream_failed"
  | "inventory_incomplete"
  | "internal_error";

export function classifyError(
  error: unknown,
): { status: number; code: ErrorCode } {
  if (error instanceof UpstreamError) {
    return { status: 502, code: "upstream_failed" };
  }
  if (error instanceof InventoryIncompleteError) {
    return { status: 500, code: "inventory_incomplete" };
  }
  return { status: 500, code: "internal_error" };
}
