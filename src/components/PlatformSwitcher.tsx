import { usePlatform, Platform } from "@/contexts/PlatformContext";
import { motion } from "framer-motion";
import { useSidebar } from "@/components/ui/sidebar";

const platformIcons: Record<Platform, string> = {
  Maloum: "M",
  Brezzels: "B",
};

export function PlatformSwitcher() {
  const { platform, setPlatform, platforms } = usePlatform();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <div className={`mb-8 transition-all duration-300 ease-in-out ${collapsed ? "px-0 flex flex-col items-center" : "px-1"}`}>
      {!collapsed && (
        <p className="text-[9px] uppercase tracking-[0.25em] text-white/25 mb-3 px-3">
          Workspace
        </p>
      )}
      <div className={`flex flex-col gap-0.5 ${collapsed ? "items-center w-full" : ""}`}>
        {platforms.map((p) => {
          const isActive = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`relative flex items-center gap-3 transition-all duration-300 ease-in-out ${
                collapsed
                  ? "justify-center w-10 h-10 rounded-lg p-0"
                  : "rounded-lg px-3 py-2 text-[13px]"
              } ${
                isActive
                  ? "text-white/90"
                  : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="platform-active"
                  className={`absolute inset-0 bg-white/[0.04] border border-white/[0.06] ${
                    collapsed ? "rounded-lg" : "rounded-lg"
                  }`}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className={`relative z-10 font-semibold flex items-center justify-center tracking-wider transition-all duration-300 ${
                collapsed
                  ? "text-xs w-6 h-6 rounded-md"
                  : "text-[10px] w-5 h-5 rounded"
              } ${
                isActive
                  ? "bg-primary/15 text-primary shadow-[0_0_8px_hsl(var(--primary)/0.3)]"
                  : "bg-white/[0.04] text-white/30"
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
