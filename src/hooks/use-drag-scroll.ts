import { useEffect, useRef, useState } from "react";

/**
 * Drag-to-Scroll für horizontale Container (Desktop / Maus).
 * - Touch wird ignoriert (natives Scrollen bleibt).
 * - Momentum nach Loslassen + magnetisches Snap auf nächstes Kind mit
 *   Selektor `snapSelector` (default: `.snap-start`).
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>(opts?: {
  snapSelector?: string;
}) {
  const ref = useRef<T | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const snapSelector = opts?.snapSelector ?? ".snap-start";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let moved = 0;
    let raf = 0;
    let pointerId = -1;

    const snapToNearest = () => {
      const children = el.querySelectorAll<HTMLElement>(snapSelector);
      if (!children.length) return;
      const containerRect = el.getBoundingClientRect();
      const centerX = containerRect.left + containerRect.width / 2;
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      children.forEach((c) => {
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const d = Math.abs(cx - centerX);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      });
      if (!best) return;
      const r = best.getBoundingClientRect();
      const target =
        el.scrollLeft + (r.left + r.width / 2) - (containerRect.left + containerRect.width / 2);
      el.scrollTo({ left: target, behavior: "smooth" });
    };

    const momentum = () => {
      if (Math.abs(velocity) < 0.4) {
        snapToNearest();
        return;
      }
      el.scrollLeft -= velocity;
      velocity *= 0.92;
      raf = requestAnimationFrame(momentum);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      cancelAnimationFrame(raf);
      active = true;
      moved = 0;
      velocity = 0;
      startX = e.clientX;
      lastX = e.clientX;
      lastT = performance.now();
      startScroll = el.scrollLeft;
      pointerId = e.pointerId;
      // Snap während des Drags deaktivieren — sonst kämpft scroll-snap gegen scrollLeft-Setting
      el.style.scrollSnapType = "none";
      el.style.scrollBehavior = "auto";
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
      try { el.setPointerCapture(e.pointerId); } catch {}
      setIsDragging(true);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 2) e.preventDefault?.();
      moved = Math.max(moved, Math.abs(dx));
      el.scrollLeft = startScroll - dx;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = ((e.clientX - lastX) / dt) * 16;
      lastX = e.clientX;
      lastT = now;
    };


    const endDrag = () => {
      if (!active) return;
      active = false;
      el.style.cursor = "";
      el.style.userSelect = "";
      setIsDragging(false);
      if (moved > 4) {
        // Click direkt nach Drag unterdrücken
        const block = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener("click", block, true);
        };
        window.addEventListener("click", block, true);
        setTimeout(() => window.removeEventListener("click", block, true), 0);
      }
      raf = requestAnimationFrame(momentum);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      endDrag();
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [snapSelector]);

  return { ref, isDragging };
}

export default useDragScroll;
