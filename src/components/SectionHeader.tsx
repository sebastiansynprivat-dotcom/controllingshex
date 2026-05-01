import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/**
 * Apple-Pro-style section header:
 *   tiny uppercase eyebrow → big tight title → optional subtitle.
 * Optional `right` slot for status chips / actions.
 */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  right,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-end justify-between gap-4 mb-6",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="kpi-label mb-2">{eyebrow}</div>
        )}
        <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white/95 leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1.5 text-sm text-white/60 font-light">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

export default SectionHeader;
