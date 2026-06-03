import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Wie weit das unsichtbare Anziehungs-/Hit-Feld um das Element erweitert wird (px). */
  range?: number;
  /** Wie stark der eingerastete Cursor zur Element-Mitte gezogen wird (0–1). */
  pull?: number;
  className?: string;
  as?: "span" | "div";
}

/**
 * Magnetischer Cursor-Effekt: Sobald der Mauszeiger in das erweiterte Hit-Feld
 * rund um das Element eintritt, wird der OS-Cursor in dieser Zone ausgeblendet
 * und durch einen kleinen "magnetischen" Dot ersetzt, der zur Element-Mitte
 * gezogen wird. Dazu wird der Klick-Bereich vergrößert — ein Klick im Hit-Feld
 * wird auf das innere interaktive Element (oder den Wrapper) weitergeleitet.
 * Nur aktiv auf Pointer-Devices mit Hover (Desktop).
 */
export function MagneticHover({
  children,
  range = 22,
  pull = 0.55,
  className,
  as = "span",
}: Props) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLSpanElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    enabledRef.current = true;

    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!wrap || !overlay || !dot || !ring) return;

    const show = () => {
      dot.style.opacity = "1";
      ring.style.opacity = "1";
    };
    const hide = () => {
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const px = e.clientX - dx * pull;
      const py = e.clientY - dy * pull;
      dot.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      ring.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    };

    overlay.addEventListener("pointerenter", show);
    overlay.addEventListener("pointermove", onMove, { passive: true });
    overlay.addEventListener("pointerleave", hide);

    return () => {
      overlay.removeEventListener("pointerenter", show);
      overlay.removeEventListener("pointermove", onMove);
      overlay.removeEventListener("pointerleave", hide);
    };
  }, [pull]);

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
      // Bubble click an Elternelement (z. B. klickbare Card-Row)
      wrap.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };

  const Wrapper = as;
  return (
    <>
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
            cursor: "none",
            zIndex: 1,
          }}
        />
      </Wrapper>
      {typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              ref={ringRef}
              aria-hidden
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                width: 26,
                height: 26,
                marginLeft: -13,
                marginTop: -13,
                borderRadius: 9999,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.04)",
                backdropFilter: "blur(2px)",
                pointerEvents: "none",
                opacity: 0,
                transition: "opacity 140ms ease",
                zIndex: 2147483646,
                willChange: "transform",
              }}
            />
            <div
              ref={dotRef}
              aria-hidden
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                width: 6,
                height: 6,
                marginLeft: -3,
                marginTop: -3,
                borderRadius: 9999,
                background: "rgba(255,255,255,0.95)",
                mixBlendMode: "difference",
                pointerEvents: "none",
                opacity: 0,
                transition: "opacity 120ms ease",
                zIndex: 2147483647,
                willChange: "transform",
              }}
            />
          </>,
          document.body,
        )}
    </>
  );
}

export default MagneticHover;
