import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-depth">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b border-white/[0.04] px-8 sticky top-0 z-10 backdrop-blur-2xl bg-background/60">
            <SidebarTrigger className="text-white/30 hover:text-white/60 transition-colors duration-500" />
          </header>
          <main className="flex-1 p-10 lg:p-14 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
