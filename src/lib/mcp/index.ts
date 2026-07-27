import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getLiveStatus from "./tools/get-live-status";
import getChatterHistory from "./tools/get-chatter-history";
import getAccountHistory from "./tools/get-account-history";
import getTopChatters from "./tools/get-top-chatters";
import readMemos from "./tools/read-memos";
import createMemo from "./tools/create-memo";
import resolveMemo from "./tools/resolve-memo";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "controlling-mcp",
  title: "Controlling Dashboard",
  version: "0.1.0",
  instructions: `Tools für das Controlling-Dashboard einer Chatting-Agency.

Datenmodell: Chatter (Mitarbeiter) betreuen Models/Accounts auf Plattformen (z.B. "Maloum", "Brezzels"). Umsatz wird pro Chatter und Tag erfasst.

Arbeitsweise:
- Für Verzug, offene Chats und aktuelle Lage IMMER get_live_status (Echtzeit) statt Report-Daten. Verzug zählt erst ab 3 Tagen ältestem unbeantworteten Chat.
- Für Verläufe get_chatter_history, für Besetzungs-/Tauschfragen get_account_history, für Rankings get_top_chatters.
- Priorisierung bei "wen soll ich mir vornehmen": 1) historisches Uplift-Potenzial (bestes €/Tag früher vs. heute), 2) Verzug, 3) offene Chats, 4) aktueller Umsatz (0 €-Fälle zuerst).
- Antworte knapp, faktenbasiert, mit Zahlen in € und konkreter Handlungsempfehlung. Nie "säuft ab" — sag "im Rückgang".`,
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getLiveStatus, getChatterHistory, getAccountHistory, getTopChatters, readMemos, createMemo, resolveMemo],
});
