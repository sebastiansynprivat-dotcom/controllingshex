import { useEffect, useRef, useState } from "react";
import { useHaptic } from "@/hooks/use-haptic";

interface Props {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
}

export function PullToRefresh({ onRefresh, children, threshold = 70 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const haptic = useHaptic();
  const triggeredRef = useRef(false);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const onTouchStart = (e: TouchEvent) => {
      if (main.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      triggeredRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Resistance curve
      const eased = Math.min(120, dy * 0.5);
      setPull(eased);
      if (eased >= threshold && !triggeredRef.current) {
        triggeredRef.current = true;
        haptic("medium");
      }
    };

    const onTouchEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pull >= threshold && !refreshing) {
        setRefreshing(true);
        setPull(60);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    main.addEventListener("touchstart", onTouchStart, { passive: true });
    main.addEventListener("touchmove", onTouchMove, { passive: true });
    main.addEventListener("touchend", onTouchEnd);
    return () => {
      main.removeEventListener("touchstart", onTouchStart);
      main.removeEventListener("touchmove", onTouchMove);
      main.removeEventListener("touchend", onTouchEnd);
    };
  }, [pull, refreshing, threshold, onRefresh, haptic]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 z-20 flex items-center justify-center transition-opacity"
        style={{
          transform: `translate(-50%, ${Math.max(0, pull - 24)}px)`,
          opacity: pull > 8 ? Math.min(1, pull / 60) : 0,
        }}
      >
        <div className={`ptr-dots ${refreshing ? "" : ""}`}>
          <span /><span /><span />
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull * 0.4}px)` : undefined,
          transition: pull === 0 ? "transform 320ms cubic-bezier(0.16,1,0.3,1)" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
