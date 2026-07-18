// Placeholder data for the Get-Chats flow. Swap for real API responses later.

export interface LinkedUser {
  username: string;
  chatid: string;
}

export const PLACEHOLDER_LINKED_USERS: LinkedUser[] = [
  { username: "@maxmuster", chatid: "chat_1001" },
  { username: "@lisak", chatid: "chat_1002" },
  { username: "@johndoe", chatid: "chat_1003" },
  { username: "@sarah_b", chatid: "chat_1004" },
];

export interface MockMessage {
  id: string;
  from: "customer" | "chatter";
  text: string;
  at: string; // ISO
}

export interface MockChat {
  chatid: string;
  username: string;
  lastMessageAt: string;
  preview: string;
  messages: MockMessage[];
}

export const MOCK_CHATS: MockChat[] = [
  {
    chatid: "chat_1001",
    username: "@maxmuster",
    lastMessageAt: "2026-07-17T14:22:00Z",
    preview: "Klar, schick mal 🏻",
    messages: [
      { id: "m1", from: "customer", text: "Hey, was machst du?", at: "2026-07-17T13:55:00Z" },
      { id: "m2", from: "chatter", text: "Chille zuhause, du? 🏻", at: "2026-07-17T14:01:00Z" },
      { id: "m3", from: "customer", text: "Auch. Hast du was Neues?", at: "2026-07-17T14:15:00Z" },
      { id: "m4", from: "chatter", text: "Klar, schick mal 🏻", at: "2026-07-17T14:22:00Z" },
    ],
  },
  {
    chatid: "chat_1002",
    username: "@lisak",
    lastMessageAt: "2026-07-17T12:04:00Z",
    preview: "Danke dir!",
    messages: [
      { id: "m1", from: "chatter", text: "Guten Morgen 🏻", at: "2026-07-17T11:30:00Z" },
      { id: "m2", from: "customer", text: "Morgen! Alles gut?", at: "2026-07-17T11:45:00Z" },
      { id: "m3", from: "customer", text: "Danke dir!", at: "2026-07-17T12:04:00Z" },
    ],
  },
  {
    chatid: "chat_1003",
    username: "@johndoe",
    lastMessageAt: "2026-07-16T22:11:00Z",
    preview: "Bis morgen 🏻",
    messages: [
      { id: "m1", from: "customer", text: "Bin müde", at: "2026-07-16T22:00:00Z" },
      { id: "m2", from: "chatter", text: "Schlaf gut, bis morgen 🏻", at: "2026-07-16T22:11:00Z" },
    ],
  },
];
