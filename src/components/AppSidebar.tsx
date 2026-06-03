import { LayoutDashboard, Upload, Users, Settings, MessageSquareText, LogOut, Trophy, StickyNote, Flame, AlertOctagon, Target, ListChecks, Radio } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { PlatformSwitcher } from "@/components/PlatformSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Heute", url: "/today", icon: ListChecks },
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Live-Tracking", url: "/live", icon: Radio },
  { title: "Auffälligkeiten", url: "/auffaelligkeiten", icon: AlertOctagon },
  { title: "Monatsziele", url: "/monatsziele", icon: Target },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "AI Consultant", url: "/ai-consultant", icon: MessageSquareText },
  { title: "Swipe Mode", url: "/tinder", icon: Flame },
  { title: "Texts", url: "/notes", icon: StickyNote },
  { title: "Models & Follower", url: "/models", icon: Users },
  { title: "Einstellungen", url: "/settings", icon: Settings },
];


export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut, user } = useAuth();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="sidebar-premium border-r border-white/[0.04]">
      <SidebarContent style={{ paddingTop: "calc(max(env(safe-area-inset-top), 0px) + 2.5rem)" }} className={`relative transition-all duration-300 ease-in-out flex flex-col h-full ${collapsed ? "px-0 items-center" : "px-3"}`}>
        {/* Brand */}
        <div className={`mb-10 transition-all duration-300 ease-in-out ${collapsed ? "flex justify-center px-0" : "px-3"}`}>
          {!collapsed ? (
            <h1 className="text-sm font-semibold tracking-[0.2em] uppercase gold-text">
              Controlling
            </h1>
          ) : (
            <span className="text-sm font-semibold gold-text flex items-center justify-center w-10 h-10 rounded-lg premium-chip bg-gradient-to-b from-primary/15 to-primary/5 border border-primary/20">
              C
            </span>
          )}
        </div>

        <PlatformSwitcher />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={`sidebar-item group relative flex items-center rounded-lg text-white/55 transition-all duration-300 ease-out hover:text-white/90 ${
                        collapsed ? "justify-center px-0 py-2.5 w-10 h-10 mx-auto" : "gap-3 px-3 py-2.5"
                      }`}
                      activeClassName="sidebar-item-active text-foreground"
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover:scale-105" />
                      {!collapsed && <span className="text-sm font-light tracking-wide">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Spacer + Logout */}
        <div className="mt-auto w-full" style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom), 0px) + 1.5rem)" }}>
          {!collapsed && user && (
            <div className="mx-3 mb-3 pt-3 border-t border-white/[0.04]">
              <p className="text-[11px] text-white/30 font-light truncate tracking-wide">{user.email}</p>
            </div>
          )}
          <button
            onClick={signOut}
            className={`flex items-center rounded-lg text-white/30 hover:text-red-400/80 hover:bg-red-500/5 transition-all duration-300 ${
              collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-3 py-2.5 w-full"
            }`}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span className="text-sm font-light tracking-wide">Abmelden</span>}
          </button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
