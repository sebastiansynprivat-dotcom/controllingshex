import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Wie weit das unsichtbare Anziehungs-/Hit-Feld um das Element erweitert wird (px). */
  range?: number;
  className?: string;
  as?: "span" | "div";
}

/**
 * Magnetischer Cursor-Effekt: Sobald der Mauszeiger in das erweiterte Hit-Feld
 * eintritt, gleitet der globale LuxuryCursor sanft zur Element-Mitte
 * (per Snap-Event). Kein zusätzlicher Dot — der bestehende Cursor "hüpft"
 * smooth rüber. Der Klick-Bereich ist vergrößert.
 */
export function MagneticHover({
  children,
  range = 22,
  className,
  as = "span",
}: Props) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !overlay) return;

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

    overlay.addEventListener("pointerenter", dispatchSnap);
    overlay.addEventListener("pointerleave", release);
    // Bei Scroll/Resize: Position aktualisieren, solange drin
    return () => {
      overlay.removeEventListener("pointerenter", dispatchSnap);
      overlay.removeEventListener("pointerleave", release);
      release();
    };
  }, []);

  const forwardClick = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    e.stopPropagation();
    e.preventDefault();
    const interactive = wrap.querySelector<HTMLElement>(
      'button,a,[role="button"],[tabindex]:not([tabindex="-1"])',
    );
    if (interactive) {
      interactive.click();
    } else {
      wrap.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };

  const Wrapper = as;
  return (
    <Wrapper
      ref={wrapRef as React.RefObject<HTMLDivElement & HTMLSpanElement>}
      className={cn("relative inline-block", className)}
    >
      {children}
      <span
        ref={overlayRef}
        aria-hidden
        onClick={forwardClick}
        style={{
          position: "absolute",
          inset: `-${range}px`,
          zIndex: 1,
        }}
      />
    </Wrapper>
  );
}

export default MagneticHover;
