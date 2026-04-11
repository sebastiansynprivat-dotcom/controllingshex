import { LayoutDashboard, Upload, Users, Settings, MessageSquareText } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { PlatformSwitcher } from "@/components/PlatformSwitcher";
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
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "AI Consultant", url: "/ai-consultant", icon: MessageSquareText },
  { title: "Models & Follower", url: "/models", icon: Users },
  { title: "Einstellungen", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r border-white/[0.04]">
      <SidebarContent className={`pt-10 transition-all duration-300 ease-in-out ${collapsed ? "px-0 items-center" : "px-3"}`}>
        <div className={`mb-10 transition-all duration-300 ease-in-out ${collapsed ? "flex justify-center px-0" : "px-3"}`}>
          {!collapsed ? (
            <h1 className="text-sm font-semibold tracking-[0.2em] uppercase gold-text-subtle">
              Controlling
            </h1>
          ) : (
            <span className="text-sm font-semibold gold-text-subtle flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
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
                      className={`flex items-center rounded-lg text-white/35 transition-all duration-300 ease-in-out hover:text-white/70 hover:bg-white/[0.03] ${
                        collapsed ? "justify-center px-0 py-2.5 w-10 h-10 mx-auto" : "gap-3 px-3 py-2.5"
                      }`}
                      activeClassName="text-white/90 bg-white/[0.04]"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-[13px] font-light tracking-wide">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
