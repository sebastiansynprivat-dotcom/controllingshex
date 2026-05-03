import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePlatform } from "@/contexts/PlatformContext";
import OnboardingTab from "@/components/notes/OnboardingTab";
import ChannelTab from "@/components/notes/ChannelTab";
import StandardTab from "@/components/notes/StandardTab";

export default function Notes() {
  const { platform } = usePlatform();
  const [tab, setTab] = useState<"onboarding" | "standard" | "channel">("onboarding");

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "onboarding" | "standard" | "channel")} className="space-y-4 sm:space-y-6">
        <TabsList className="bg-white/[0.04] border border-white/[0.08] p-1 h-auto">
          <TabsTrigger value="onboarding" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary text-foreground/65 text-xs sm:text-sm font-medium px-4 py-2">
            Onboarding
          </TabsTrigger>
          <TabsTrigger value="standard" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary text-foreground/65 text-xs sm:text-sm font-medium px-4 py-2">
            Standard
          </TabsTrigger>
          <TabsTrigger value="channel" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary text-foreground/65 text-xs sm:text-sm font-medium px-4 py-2">
            Channel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding" className="mt-0">
          <OnboardingTab />
        </TabsContent>
        <TabsContent value="standard" className="mt-0">
          <StandardTab />
        </TabsContent>
        <TabsContent value="channel" className="mt-0">
          <ChannelTab platform={platform} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
