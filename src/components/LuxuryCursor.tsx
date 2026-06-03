import { useEffect, useRef, useState } from "react";

/**
 * Luxuriöser Custom Cursor (nur Desktop / Pointer-Geräte).
 * - Feiner goldener Dot folgt 1:1
 * - Dezenter Ring lagged mit Spring-Feeling hinterher
 * - Hover über interaktive Elemente -> Ring vergrößert sich, Dot wird kleiner
 * - Click -> kurzer Scale-Puls
 */
export function LuxuryCursor() {
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  const mouse = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const stateRef = useRef({ hover: false, down: false, visible: false });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf = 0;
    const tick = () => {
      ring.current.x += (mouse.current.x - ring.current.x) * 0.18;
      ring.current.y += (mouse.current.y - ring.current.y) * 0.18;

      const hover = stateRef.current.hover;
      const down = stateRef.current.down;

      const ringScale = hover ? 1.55 : down ? 0.85 : 1;
      const dotScale = hover ? 0.55 : down ? 1.4 : 1;

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mouse.current.x}px, ${mouse.current.y}px, 0) translate(-50%, -50%) scale(${dotScale})`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%) scale(${ringScale})`;
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
          width: 34,
          height: 34,
          borderRadius: "9999px",
          border: "1px solid hsl(var(--gold) / 0.55)",
          boxShadow:
            "0 0 18px hsl(var(--gold) / 0.18), inset 0 0 8px hsl(var(--gold) / 0.08)",
          background:
            "radial-gradient(circle at 30% 30%, hsl(var(--gold) / 0.10), transparent 70%)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          pointerEvents: "none",
          zIndex: 2147483646,
          opacity: 0,
          transition:
            "opacity 200ms ease, border-color 180ms ease, box-shadow 180ms ease",
          willChange: "transform",
          mixBlendMode: "normal",
        }}
      />
      <div
        ref={dotRef}
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 6,
          height: 6,
          borderRadius: "9999px",
          background:
            "radial-gradient(circle at 35% 35%, hsl(var(--gold-light)), hsl(var(--gold-dark)))",
          boxShadow:
            "0 0 8px hsl(var(--gold) / 0.7), 0 0 2px hsl(var(--gold-light) / 0.9)",
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
