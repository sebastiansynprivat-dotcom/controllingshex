/**
 * Channel-Klassifikation anhand des Chatter-Namens.
 *
 * WhatsApp = Nachname abgekürzt ("Philip S.", "Philip Sc", "Philip Sch")
 *            → letzter Token endet auf "." ODER ist max. 3 Zeichen lang.
 * Plattform = Vor- + Nachname voll ausgeschrieben ("Philip Schmidt").
 * Ein-Wort-Namen fallen auf Plattform zurück.
 */
export type ChatterChannel = "whatsapp" | "platform";

export function classifyChannel(name: string): ChatterChannel {
  const tokens = (name ?? "").trim().split(/\s+/);
  if (tokens.length < 2) return "platform";
  const last = tokens[tokens.length - 1];
  if (last.endsWith(".")) return "whatsapp";
  if (last.replace(/\.$/, "").length <= 3) return "whatsapp";
  return "platform";
}
