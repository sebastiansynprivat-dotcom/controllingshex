import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Reichweite in px, ab der die magnetische Anziehung greift. */
  range?: number;
  /** Wie stark der Inhalt zum Cursor wandert (0–1). 0.25 = subtil. */
  strength?: number;
  /** Maximaler Versatz in px — kappt die Verschiebung. */
  maxShift?: number;
  className?: string;
  as?: "span" | "div";
}

/**
 * Subtiler "magnetischer" Pull-Effekt: nähert sich der Cursor dem Element,
 * wandert der Inhalt einen kleinen Tick Richtung Mauszeiger — fühlt sich
 * smoother an beim Klicken. Nur aktiv auf Pointer-Devices mit Hover.
 */
export function MagneticHover({
  children,
  range = 56,
  strength = 0.28,
  maxShift = 8,
  className,
  as = "span",
}: Props) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Nur Desktop / echte Mauszeiger
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const tick = () => {
      const cur = currentRef.current;
      const tgt = targetRef.current;
      cur.x += (tgt.x - cur.x) * 0.22;
      cur.y += (tgt.y - cur.y) * 0.22;
      if (Math.abs(cur.x - tgt.x) < 0.05 && Math.abs(cur.y - tgt.y) < 0.05) {
        cur.x = tgt.x;
        cur.y = tgt.y;
        inner.style.transform = `translate3d(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px, 0)`;
        frameRef.current = null;
        return;
      }
      inner.style.transform = `translate3d(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px, 0)`;
      frameRef.current = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (frameRef.current == null) frameRef.current = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      // Distanz zum Rand des Elements, nicht zum Mittelpunkt
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      const edgeDx = Math.max(0, Math.abs(dx) - halfW);
      const edgeDy = Math.max(0, Math.abs(dy) - halfH);
      const edgeDist = Math.hypot(edgeDx, edgeDy);
      if (edgeDist > range) {
        targetRef.current = { x: 0, y: 0 };
      } else {
        // Falloff: nah am Element = volle Stärke, am Rand der Range = 0
        const falloff = 1 - edgeDist / range;
        let tx = dx * strength * falloff;
        let ty = dy * strength * falloff;
        const mag = Math.hypot(tx, ty);
        if (mag > maxShift) {
          const k = maxShift / mag;
          tx *= k;
          ty *= k;
        }
        targetRef.current = { x: tx, y: ty };
      }
      schedule();
    };

    const reset = () => {
      targetRef.current = { x: 0, y: 0 };
      const tickIn = () => {
        const cur = currentRef.current;
        cur.x *= 0.8;
        cur.y *= 0.8;
        if (Math.abs(cur.x) < 0.1 && Math.abs(cur.y) < 0.1) {
          cur.x = 0;
          cur.y = 0;
          inner.style.transform = "translate3d(0,0,0)";
          frameRef.current = null;
          return;
        }
        inner.style.transform = `translate3d(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px, 0)`;
        frameRef.current = requestAnimationFrame(tickIn);
      };
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(tickIn);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", reset, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", reset);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [range, strength, maxShift]);

  const Wrapper = as;
  return (
    <Wrapper
      ref={wrapRef as React.RefObject<HTMLDivElement & HTMLSpanElement>}
      className={cn("inline-block", className)}
    >
      <span
        ref={innerRef}
        className="inline-block will-change-transform"
        style={{ transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {children}
      </span>
    </Wrapper>
  );
}

export default MagneticHover;
