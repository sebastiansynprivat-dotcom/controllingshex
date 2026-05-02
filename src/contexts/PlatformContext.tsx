import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Platform = "Maloum" | "Brezzels";

const PLATFORMS: Platform[] = ["Maloum", "Brezzels"];

interface PlatformContextType {
  platform: Platform;
  setPlatform: (p: Platform) => void;
  platforms: Platform[];
}

const PlatformContext = createContext<PlatformContextType | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatformState] = useState<Platform>(() => {
    const saved = localStorage.getItem("activePlatform");
    return PLATFORMS.includes(saved as Platform) ? (saved as Platform) : "Maloum";
  });

  const setPlatform = (nextPlatform: Platform) => {
    localStorage.setItem("activePlatform", nextPlatform);
    setPlatformState(nextPlatform);
  };

  useEffect(() => {
    localStorage.setItem("activePlatform", platform);
  }, [platform]);

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
