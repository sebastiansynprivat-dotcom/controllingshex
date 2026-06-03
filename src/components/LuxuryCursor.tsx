import { useEffect, useRef, useState } from "react";

/**
 * Minimaler Custom Cursor (nur Desktop / Pointer-Geräte).
 * - Feiner goldener Dot folgt 1:1
 * - Bei Hover über interaktive Elemente wird der Dot leicht kleiner
 * - Klick -> kurzer Scale-Puls
 */
export function LuxuryCursor() {
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  const mouse = useRef({ x: -100, y: -100 });
  const pos = useRef({ x: -100, y: -100 });
  const snap = useRef<{ x: number; y: number } | null>(null);
  const stateRef = useRef({ hover: false, down: false, visible: false });

  useEffect(() => {
    if (!enabled) {
      document.documentElement.classList.remove("lux-cursor-active");
      return;
    }
    document.documentElement.classList.add("lux-cursor-active");

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
      if (!stateRef.current.visible) {
        stateRef.current.visible = true;
        pos.current.x = e.clientX;
        pos.current.y = e.clientY;
        if (dotRef.current) dotRef.current.style.opacity = "1";
        if (ringRef.current) ringRef.current.style.opacity = "1";
      }
      const target = e.target as HTMLElement | null;
      const interactive = !!target?.closest(
        'a, button, [role="button"], input, textarea, select, label, [data-cursor="hover"]'
      );
      stateRef.current.hover = interactive;
    };

    const onLeave = () => {
      stateRef.current.visible = false;
      if (dotRef.current) dotRef.current.style.opacity = "0";
      if (ringRef.current) ringRef.current.style.opacity = "0";
    };
    const onDown = () => (stateRef.current.down = true);
    const onUp = () => (stateRef.current.down = false);

    const onSnap = (e: Event) => {
      const ce = e as CustomEvent<{ x: number; y: number } | null>;
      snap.current = ce.detail ?? null;
      if (snap.current) stateRef.current.hover = true;
    };
    const onSnapRelease = () => {
      snap.current = null;
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("lux-cursor-snap", onSnap as EventListener);
    window.addEventListener("lux-cursor-release", onSnapRelease);

    let raf = 0;
    const tick = () => {
      const hover = stateRef.current.hover;
      const down = stateRef.current.down;
      const snapped = snap.current;
      const dotScale = snapped ? 0.8 : hover ? 0.6 : down ? 1.3 : 1;
      const ringScale = snapped ? 1.7 : hover ? 1.4 : down ? 0.8 : 1;

      const targetX = snapped ? snapped.x : mouse.current.x;
      const targetY = snapped ? snapped.y : mouse.current.y;
      // Lerp nur wenn gesnappt — sonst 1:1 mit Maus
      if (snapped) {
        pos.current.x += (targetX - pos.current.x) * 0.22;
        pos.current.y += (targetY - pos.current.y) * 0.22;
      } else {
        pos.current.x = targetX;
        pos.current.y = targetY;
      }

      const tx = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0) translate(-50%, -50%)`;
      if (dotRef.current) {
        dotRef.current.style.transform = `${tx} scale(${dotScale})`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `${tx} scale(${ringScale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("lux-cursor-snap", onSnap as EventListener);
      window.removeEventListener("lux-cursor-release", onSnapRelease);
      document.documentElement.classList.remove("lux-cursor-active");
    };
  }, [enabled]);


  if (!enabled) return null;

  return (
    <>
      <div
        ref={ringRef}
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 26,
          height: 26,
          borderRadius: "9999px",
          border: "1px solid hsl(var(--gold) / 0.55)",
          boxShadow: "0 0 8px hsl(var(--gold) / 0.18)",
          pointerEvents: "none",
          zIndex: 2147483646,
          opacity: 0,
          transition: "opacity 200ms ease",
          willChange: "transform",
        }}
      />
      <div
        ref={dotRef}
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 5,
          height: 5,
          borderRadius: "9999px",
          background:
            "radial-gradient(circle at 35% 35%, hsl(var(--gold-light)), hsl(var(--gold-dark)))",
          boxShadow:
            "0 0 6px hsl(var(--gold) / 0.6), 0 0 2px hsl(var(--gold-light) / 0.8)",
          pointerEvents: "none",
          zIndex: 2147483647,
          opacity: 0,
          transition: "opacity 200ms ease",
          willChange: "transform",
        }}
      />
    </>
  );
}


export default LuxuryCursor;
