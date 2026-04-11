import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-[100dvh] flex w-full bg-depth overflow-x-hidden max-w-[100vw]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          <header className="h-14 flex items-center border-b border-white/[0.04] px-4 sm:px-8 sticky top-0 z-10 backdrop-blur-2xl bg-background/60 shrink-0">
            <SidebarTrigger className="text-white/30 hover:text-white/60 transition-colors duration-500" />
          </header>
          <main className="flex-1 min-w-0 p-3 sm:p-8 lg:p-14 overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
