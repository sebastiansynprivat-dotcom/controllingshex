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

  // Re-mount counters when config identity changes
  return (
    <div className="min-h-screen px-4 pt-6 pb-12 max-w-xl mx-auto">
      <PushHeader
        onTripleTap={() => setSettingsOpen(true)}
        tapsRef={tapsRef}
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

function PushHeader({
  onTripleTap,
  tapsRef,
}: {
  onTripleTap: () => void;
  tapsRef: React.MutableRefObject<number[]>;
}) {
  const handleTap = () => {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 600), now];
    if (tapsRef.current.length >= 3) {
      tapsRef.current = [];
      onTripleTap();
    }
  };
  return (
    <header className="mb-6">
      <h1
        onClick={handleTap}
        className="text-2xl font-light tracking-[0.18em] uppercase text-white/90 select-none cursor-default"
      >
        Push
      </h1>
      <p className="text-xs text-white/40 font-light mt-1">
        Live Aktivität in Echtzeit
      </p>
    </header>
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
  // Key forces remount when bounds/timing change drastically — but we want smooth updates.
  // Instead pass the config; hook updates trend/min/max live without remount.
  const chatters = useFakeCounter(config.chatters);
  const users = useFakeCounter(config.users);

  // Re-clamp + update happens in hook via ref. We just render.
  useEffect(() => {
    document.title = "Push – Live";
  }, []);

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
      </div>

      <PushSimulationSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onChange={onUpdateConfig}
        onReroll={(which) => {
          if (which === "chatters") chatters.reroll();
          else users.reroll();
        }}
      />
    </>
  );
}
