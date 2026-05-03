import { useState } from "react";
import ChannelKnowledgeList from "./ChannelKnowledgeList";
import ChannelPlanGenerator from "./ChannelPlanGenerator";
import ChannelPlanView from "./ChannelPlanView";

interface Props { platform: string }

export default function ChannelTab({ platform }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <ChannelKnowledgeList platform={platform} />

      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight">Wochenplan</h3>
            <p className="text-[11px] text-foreground/55 font-light">AI generiert auf Basis der Wissensbasis, mit Wochentag, Saison & deutschen Feiertagen.</p>
          </div>
          <ChannelPlanGenerator platform={platform} onGenerated={() => setRefreshKey((k) => k + 1)} />
        </div>
        <ChannelPlanView platform={platform} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
