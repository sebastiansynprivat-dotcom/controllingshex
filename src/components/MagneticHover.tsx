import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Wie weit das unsichtbare Anziehungsfeld um das Element erweitert wird (px). */
  range?: number;
  className?: string;
  as?: "span" | "div";
}

/**
 * Magnetischer Cursor-Effekt: Sobald der Mauszeiger nah genug am Element ist,
 * gleitet der globale LuxuryCursor sanft zur Element-Mitte (per Snap-Event).
 * Es wird KEIN Overlay-Span gerendert — Klicks auf umliegende Elemente
 * bleiben uneingeschränkt möglich.
 */
export function MagneticHover({
  children,
  range = 22,
  className,
  as = "span",
}: Props) {
  const wrapRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const wrap = wrapRef.current;
    if (!wrap) return;

    let inside = false;

    const dispatchSnap = () => {
      const rect = wrap.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      window.dispatchEvent(
        new CustomEvent("lux-cursor-snap", { detail: { x, y } }),
      );
    };
    const release = () => {
      window.dispatchEvent(new CustomEvent("lux-cursor-release"));
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const within =
        e.clientX >= rect.left - range &&
        e.clientX <= rect.right + range &&
        e.clientY >= rect.top - range &&
        e.clientY <= rect.bottom + range;
      if (within && !inside) {
        inside = true;
        dispatchSnap();
      } else if (!within && inside) {
        inside = false;
        release();
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (inside) release();
    };
  }, [range]);

  const Wrapper = as;
  return (
    <Wrapper
      ref={wrapRef as React.RefObject<HTMLDivElement & HTMLSpanElement>}
      className={cn("relative inline-block", className)}
    >
      {children}
    </Wrapper>
  );
}

export default MagneticHover;
