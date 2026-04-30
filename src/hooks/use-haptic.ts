/**
 * Subtle haptic feedback for mobile (iOS PWA + Android).
 * Falls back silently when unsupported.
 */
type Strength = "light" | "medium" | "success";

export function useHaptic() {
  return (strength: Strength = "light") => {
    try {
      if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
      const pattern =
        strength === "success" ? [6, 24, 8] : strength === "medium" ? 14 : 6;
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  };
}
