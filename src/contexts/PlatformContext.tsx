import { createContext, useContext, useState, ReactNode } from "react";

export type Platform = "Maloum" | "Brezzels" | "FansyMe";

const PLATFORMS: Platform[] = ["Maloum", "Brezzels", "FansyMe"];

interface PlatformContextType {
  platform: Platform;
  setPlatform: (p: Platform) => void;
  platforms: Platform[];
}

const PlatformContext = createContext<PlatformContextType | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>("Maloum");
  return (
    <PlatformContext.Provider value={{ platform, setPlatform, platforms: PLATFORMS }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
