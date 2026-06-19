import { useEffect, useRef, useState } from "react";
import PushCounterCard from "@/components/push/PushCounterCard";
import PushSimulationSheet from "@/components/push/PushSimulationSheet";
import {
  loadPushConfig,
  savePushConfig,
  useFakeCounter,
  type PushFakeConfig,
} from "@/lib/push-fake-counter";

export default function Push() {
  const [config, setConfig] = useState<PushFakeConfig>(() => loadPushConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tapsRef = useRef<number[]>([]);

  const handleHiddenTap = () => {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 600), now];
    if (tapsRef.current.length >= 3) {
      tapsRef.current = [];
      setSettingsOpen(true);
    }
  };

  useEffect(() => {
    document.title = "Push – Live";
  }, []);

  return (
    <div className="relative min-h-screen px-4 pt-4 pb-12 max-w-xl mx-auto">
      {/* Hidden triple-tap trigger */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={handleHiddenTap}
        className="absolute top-2 right-2 h-6 w-6 opacity-0"
      />

      <PushBody
        config={config}
        onUpdateConfig={(next) => {
          setConfig(next);
          savePushConfig(next);
        }}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
      />
    </div>
  );
}

function PushBody({
  config,
  onUpdateConfig,
  settingsOpen,
  setSettingsOpen,
}: {
  config: PushFakeConfig;
  onUpdateConfig: (next: PushFakeConfig) => void;
  settingsOpen: boolean;
  setSettingsOpen: (o: boolean) => void;
}) {
  const chatters = useFakeCounter(config.chatters);
  const users = useFakeCounter(config.users);
  const hotLeads = useFakeCounter(config.hotLeads);

  return (
    <>
      <div className="space-y-4">
        <PushCounterCard
          label="Chatter online"
          sub="Aktive Chatter im System"
          value={chatters.value}
          history={chatters.history}
          accent="emerald"
        />
        <PushCounterCard
          label="User auf der Plattform"
          sub="Online auf der Plattform"
          value={users.value}
          history={users.history}
          accent="pink"
        />
        <PushCounterCard
          label="Hot Leads idle"
          sub="Gute Kunden online, ohne aktiven Chat"
          value={hotLeads.value}
          history={hotLeads.history}
          accent="amber"
        />
      </div>

      <PushSimulationSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onChange={onUpdateConfig}
        onReroll={(which) => {
          if (which === "chatters") chatters.reroll();
          else if (which === "users") users.reroll();
          else hotLeads.reroll();
        }}
      />
    </>
  );
}
