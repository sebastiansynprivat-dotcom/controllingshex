import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <SidebarProvider>
      <div
        className="fixed inset-0 flex w-screen bg-depth overflow-hidden max-w-[100vw]"
        style={{
          minHeight: "-webkit-fill-available",
          height: "var(--app-height, 100dvh)",
        }}
      >
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header
            className="min-h-14 flex items-center border-b border-white/[0.04] px-4 sm:px-8 shrink-0 backdrop-blur-2xl bg-background/60 z-10"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <SidebarTrigger className="text-white/60 hover:text-white/90 transition-colors duration-500 h-10 w-10 -ml-2" />
          </header>
          <main
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pt-3 sm:px-8 sm:pt-8 lg:px-14 lg:pt-14"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
          >
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
