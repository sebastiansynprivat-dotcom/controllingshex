// Browser Web Push registration & subscription handling.
import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to ship in frontend.
const VAPID_PUBLIC_KEY =
  "BI9DaMg5DyEAA2jjiGiyW_55x5Pm1AJvX0_6ojKE-GcmRr_rlnYdc31L0MxjWcRTXYa5QbP-uRQk5fhqJQ9p17A";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushAvailableHere(): { ok: boolean; reason?: string } {
  if (!pushSupported()) return { ok: false, reason: "Browser unterstützt keine Push-Benachrichtigungen." };
  if (isInIframe()) return { ok: false, reason: "Funktioniert nicht im Lovable-Editor — bitte auf der veröffentlichten URL öffnen." };
  return { ok: true };
}

export async function getPushPermission(): Promise<NotificationPermission> {
  if (!pushSupported()) return "denied";
  return Notification.permission;
}

async function registerSW(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (existing) return existing;
  return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  const avail = pushAvailableHere();
  if (!avail.ok) return { ok: false, error: avail.reason };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Berechtigung abgelehnt." };

  try {
    const reg = await registerSW();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      });
    }

    const p256dh = arrayBufferToBase64(sub.getKey("p256dh"));
    const auth = arrayBufferToBase64(sub.getKey("auth"));

    const { error } = await supabase.functions.invoke("save-push-subscription", {
      body: {
        endpoint: sub.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
}

export async function isCurrentlySubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}
