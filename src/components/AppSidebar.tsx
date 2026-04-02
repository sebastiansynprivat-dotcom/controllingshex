import { LayoutDashboard, Users, Settings } from "lucide-react";
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
  { title: "Models & Follower", url: "/models", icon: Users },
  { title: "Einstellungen", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r border-white/[0.04]">
      <SidebarContent className="pt-10 px-3">
        <div className="px-3 mb-10">
          {!collapsed ? (
            <h1 className="text-sm font-semibold tracking-[0.2em] uppercase gold-text-subtle">
              ChatAgency
            </h1>
          ) : (
            <span className="text-sm font-semibold gold-text-subtle block text-center">C</span>
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
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/35 transition-all duration-500 hover:text-white/70 hover:bg-white/[0.03]"
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
