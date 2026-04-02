import { usePlatform, Platform } from "@/contexts/PlatformContext";
import { motion } from "framer-motion";
import { useSidebar } from "@/components/ui/sidebar";

const platformIcons: Record<Platform, string> = {
  Maloum: "M",
  Brezzels: "B",
  FansyMe: "F",
};

export function PlatformSwitcher() {
  const { platform, setPlatform, platforms } = usePlatform();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <div className="px-1 mb-8">
      <p className={`text-[9px] uppercase tracking-[0.25em] text-white/25 mb-3 ${collapsed ? "text-center" : "px-3"}`}>
        {collapsed ? "" : "Workspace"}
      </p>
      <div className="flex flex-col gap-0.5">
        {platforms.map((p) => {
          const isActive = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-500 ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "text-white/90"
                  : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="platform-active"
                  className="absolute inset-0 rounded-lg bg-white/[0.04] border border-white/[0.06]"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className={`relative z-10 text-[10px] font-semibold w-5 h-5 rounded flex items-center justify-center tracking-wider ${
                isActive ? "bg-primary/15 text-primary" : "bg-white/[0.04] text-white/30"
              }`}>
                {platformIcons[p]}
              </span>
              {!collapsed && <span className="relative z-10 font-light">{p}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
