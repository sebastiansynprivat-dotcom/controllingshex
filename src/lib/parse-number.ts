export function parseLocaleNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const negative = /^\(.*\)$/.test(raw) || raw.includes("-");
  let cleaned = raw.replace(/[^\d,.-]/g, "").replace(/-/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    cleaned = cleaned.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma !== -1) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot !== -1) {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1];
    cleaned = parts.length > 2 || (last.length === 3 && parts[0].length <= 3)
      ? parts.join("")
      : cleaned;
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}