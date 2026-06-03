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

  const mouse = useRef({ x: -100, y: -100 });
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
    };
    const onDown = () => (stateRef.current.down = true);
    const onUp = () => (stateRef.current.down = false);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf = 0;
    const tick = () => {
      const hover = stateRef.current.hover;
      const down = stateRef.current.down;
      const scale = hover ? 0.6 : down ? 1.3 : 1;

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mouse.current.x}px, ${mouse.current.y}px, 0) translate(-50%, -50%) scale(${scale})`;
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
  );
}

export default LuxuryCursor;
