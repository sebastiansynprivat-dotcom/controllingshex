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
    <div className="px-2 mb-6">
      <p className={`text-[10px] uppercase tracking-widest text-muted-foreground mb-2 ${collapsed ? "text-center" : "px-1"}`}>
        {collapsed ? "Brand" : "Workspace"}
      </p>
      <div className="flex flex-col gap-1">
        {platforms.map((p) => {
          const isActive = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300 ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="platform-active"
                  className="absolute inset-0 rounded-xl glass-card-gold gold-glow-sm"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 font-bold text-xs w-5 h-5 rounded-md flex items-center justify-center bg-primary/10">
                {platformIcons[p]}
              </span>
              {!collapsed && <span className="relative z-10">{p}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
