import { assertEquals } from "jsr:@std/assert@1";
import { classifyError, NotConfiguredError } from "./errors.ts";

Deno.test("not configured errors carry only a closed code and classify as 503", () => {
  const error = new NotConfiguredError();
  assertEquals(error.name, "NotConfiguredError");
  assertEquals(error.message, "not_configured");
  assertEquals(error.cause, undefined);
  assertEquals(classifyError(error), { status: 503, code: "not_configured" });
});

Deno.test("error text and lookalike objects cannot opt into not_configured classification", () => {
  for (
    const error of [
      new Error("not_configured"),
      { name: "NotConfiguredError", message: "not_configured" },
      { code: "42P01" },
      { code: "PGRST205" },
    ]
  ) {
    assertEquals(classifyError(error), { status: 500, code: "internal_error" });
  }
});
