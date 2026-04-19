import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="h-[100dvh] flex w-full bg-depth overflow-hidden max-w-[100vw]" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 flex items-center border-b border-white/[0.04] px-4 sm:px-8 shrink-0 backdrop-blur-2xl bg-background/60 z-10">
            <SidebarTrigger className="text-white/60 hover:text-white/90 transition-colors duration-500 h-10 w-10 -ml-2" />
          </header>
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-8 lg:p-14">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
