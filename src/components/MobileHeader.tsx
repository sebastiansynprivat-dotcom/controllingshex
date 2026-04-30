import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatform } from "@/contexts/PlatformContext";
import { useHaptic } from "@/hooks/use-haptic";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  Upload,
  Users,
  Settings,
  MessageSquareText,
  Video,
  Trophy,
  StickyNote,
  Flame,
  AlertOctagon,
} from "lucide-react";

const ROUTE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/auffaelligkeiten": "Auffälligkeiten",
  "/forecast": "Frühwarnung",
  "/upload": "Upload",
  "/tinder": "Swipe Mode",
  "/leaderboard": "Leaderboard",
  "/videocoaching": "Videocoaching",
  "/ai-consultant": "AI Consultant",
  "/notes": "Notizen",
  "/models": "Models",
  "/settings": "Einstellungen",
};

const ALL_ITEMS = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Auffälligkeiten", url: "/auffaelligkeiten", icon: AlertOctagon },
  { title: "Frühwarnung", url: "/forecast", icon: AlertOctagon },
  { title: "Videocoaching", url: "/videocoaching", icon: Video },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "AI Consultant", url: "/ai-consultant", icon: MessageSquareText },
  { title: "Swipe Mode", url: "/tinder", icon: Flame },
  { title: "Notizen", url: "/notes", icon: StickyNote },
  { title: "Models & Follower", url: "/models", icon: Users },
  { title: "Einstellungen", url: "/settings", icon: Settings },
];

export function MobileHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { platform, setPlatform, platforms } = usePlatform();
  const haptic = useHaptic();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  const title = ROUTE_TITLES[location.pathname] || "Controlling";

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 6);
    main.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  return (
    <header
      ref={headerRef}
      className={`mobile-header ${scrolled ? "scrolled" : ""}`}
    >
      <div className="flex items-center justify-between px-4 h-12">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              onClick={() => haptic("light")}
              className="press-spring h-10 w-10 -ml-2 flex items-center justify-center text-white/60 hover:text-white/90"
              aria-label="Menü öffnen"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] bg-background/95 backdrop-blur-2xl border-white/[0.06] p-0">
            <div className="drag-handle" />
            <div className="px-5 pt-2 pb-4">
              <h2 className="text-sm font-semibold tracking-[0.2em] uppercase gold-text">
                Controlling
              </h2>
            </div>
            <nav className="px-3 space-y-0.5">
              {ALL_ITEMS.map((item) => (
                <NavLink
                  key={item.url}
                  to={item.url}
                  end={item.url === "/"}
                  onClick={() => { setMenuOpen(false); haptic("light"); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-light text-white/55 hover:text-white/90 hover:bg-white/[0.04] transition-colors"
                  activeClassName="text-foreground bg-white/[0.05]"
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  <span className="tracking-wide">{item.title}</span>
                </NavLink>
              ))}
            </nav>
            {user && (
              <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/[0.05]">
                <p className="text-[11px] text-white/30 font-light truncate mb-2 tracking-wide">{user.email}</p>
                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-light text-white/40 hover:text-red-400/80 hover:bg-red-500/5 transition-colors"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                  <span>Abmelden</span>
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* Centered title (compact toolbar) */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 transition-opacity duration-300 pointer-events-none ${
            scrolled ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="font-display text-base font-light tracking-tight text-foreground/90">
            {title}
          </span>
        </div>

        {/* Platform pill switcher */}
        <div className="flex items-center gap-1 p-0.5 rounded-full bg-white/[0.03] border border-white/[0.05]">
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => { if (p !== platform) { haptic("medium"); setPlatform(p); } }}
              className={`px-2.5 py-1 text-[11px] font-medium tracking-wide rounded-full transition-all ${
                p === platform
                  ? "bg-gradient-to-b from-primary/25 to-primary/10 text-primary border border-primary/25 shadow-[0_0_12px_-2px_hsl(40_50%_60%/0.3)]"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Large title (Apple-style), fades when scrolled */}
      <div
        className={`px-5 pb-3 transition-all duration-300 ease-out overflow-hidden ${
          scrolled ? "max-h-0 opacity-0 pb-0" : "max-h-24 opacity-100"
        }`}
      >
        <h1 className="headline-display text-[34px] text-foreground">
          {title}
        </h1>
      </div>
    </header>
  );
}
