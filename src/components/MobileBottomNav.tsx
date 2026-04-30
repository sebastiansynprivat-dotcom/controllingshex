import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, AlertOctagon, Upload, Flame, Trophy } from "lucide-react";
import { useHaptic } from "@/hooks/use-haptic";

const TABS = [
  { url: "/", icon: LayoutDashboard, label: "Home" },
  { url: "/auffaelligkeiten", icon: AlertOctagon, label: "Alerts" },
  { url: "/upload", icon: Upload, label: "Upload" },
  { url: "/tinder", icon: Flame, label: "Swipe" },
  { url: "/leaderboard", icon: Trophy, label: "Top" },
];

export function MobileBottomNav() {
  const location = useLocation();
  const haptic = useHaptic();

  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      {TABS.map((tab) => {
        const active =
          tab.url === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.url);
        return (
          <NavLink
            key={tab.url}
            to={tab.url}
            onClick={() => haptic("light")}
            className={`bottom-nav-item ${active ? "bottom-nav-item-active" : ""}`}
            aria-label={tab.label}
          >
            <tab.icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.6} />
          </NavLink>
        );
      })}
    </nav>
  );
}
