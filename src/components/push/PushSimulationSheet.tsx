import { useState } from "react";
import { X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PUSH_CONFIG,
  type FakeCounterConfig,
  type PushFakeConfig,
} from "@/lib/push-fake-counter";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: PushFakeConfig;
  onChange: (cfg: PushFakeConfig) => void;
  onReroll: (which: "chatters" | "users" | "hotLeads") => void;
}

function CounterEditor({
  title,
  value,
  onChange,
  onReroll,
  onReset,
}: {
  title: string;
  value: FakeCounterConfig;
  onChange: (next: FakeCounterConfig) => void;
  onReroll: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof FakeCounterConfig>(k: K, v: FakeCounterConfig[K]) =>
    onChange({ ...value, [k]: v });

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="rounded-xl border border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/80">{title}</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/40">Pause</span>
          <Switch checked={value.paused} onCheckedChange={(c) => set("paused", c)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-white/40">Start</Label>
          <Input type="number" value={value.startValue} onChange={(e) => set("startValue", num(e.target.value))} />
        </div>
        <div>
          <Label className="text-[10px] text-white/40">Min</Label>
          <Input type="number" value={value.min} onChange={(e) => set("min", num(e.target.value))} />
        </div>
        <div>
          <Label className="text-[10px] text-white/40">Max</Label>
          <Input type="number" value={value.max} onChange={(e) => set("max", num(e.target.value))} />
        </div>
        <div>
          <Label className="text-[10px] text-white/40">Tick min (ms)</Label>
          <Input type="number" value={value.tickMinMs} onChange={(e) => set("tickMinMs", num(e.target.value))} />
        </div>
        <div>
          <Label className="text-[10px] text-white/40">Tick max (ms)</Label>
          <Input type="number" value={value.tickMaxMs} onChange={(e) => set("tickMaxMs", num(e.target.value))} />
        </div>
        <div />
        <div>
          <Label className="text-[10px] text-white/40">Step min</Label>
          <Input type="number" value={value.stepMin} onChange={(e) => set("stepMin", num(e.target.value))} />
        </div>
        <div>
          <Label className="text-[10px] text-white/40">Step max</Label>
          <Input type="number" value={value.stepMax} onChange={(e) => set("stepMax", num(e.target.value))} />
        </div>
        <div />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-white/40">Volatilität</Label>
          <span className="text-[10px] text-white/60 tabular-nums">{value.volatility.toFixed(2)}</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[value.volatility]}
          onValueChange={(v) => set("volatility", v[0] ?? 0)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-white/40">Trend (↓ / ↑)</Label>
          <span className="text-[10px] text-white/60 tabular-nums">{value.trend.toFixed(2)}</span>
        </div>
        <Slider
          min={-1}
          max={1}
          step={0.05}
          value={[value.trend]}
          onValueChange={(v) => set("trend", v[0] ?? 0)}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onReroll}>Neu würfeln</Button>
        <Button size="sm" variant="ghost" onClick={onReset}>Reset</Button>
      </div>
    </div>
  );
}

export function PushSimulationSheet({ open, onOpenChange, config, onChange, onReroll }: Props) {
  const [local, setLocal] = useState<PushFakeConfig>(config);

  // Sync local when re-opened
  const handleOpenChange = (o: boolean) => {
    if (o) setLocal(config);
    onOpenChange(o);
  };

  const apply = (next: PushFakeConfig) => {
    setLocal(next);
    onChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Schließen"
          className="absolute top-3 right-3 z-50 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/70"
        >
          <X className="h-4 w-4" />
        </button>

        <SheetHeader className="pr-12">
          <SheetTitle>Simulation</SheetTitle>
          <SheetDescription className="text-[11px] text-white/40">
            Nur Demo / Simulation – keine echten Daten.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 pb-4">
          <CounterEditor
            title="Chatter online"
            value={local.chatters}
            onChange={(c) => apply({ ...local, chatters: c })}
            onReroll={() => onReroll("chatters")}
            onReset={() => apply({ ...local, chatters: DEFAULT_PUSH_CONFIG.chatters })}
          />
          <CounterEditor
            title="User auf der Plattform"
            value={local.users}
            onChange={(c) => apply({ ...local, users: c })}
            onReroll={() => onReroll("users")}
            onReset={() => apply({ ...local, users: DEFAULT_PUSH_CONFIG.users })}
          />
          <CounterEditor
            title="Hot Leads idle"
            value={local.hotLeads}
            onChange={(c) => apply({ ...local, hotLeads: c })}
            onReroll={() => onReroll("hotLeads")}
            onReset={() => apply({ ...local, hotLeads: DEFAULT_PUSH_CONFIG.hotLeads })}
          />

          <Button
            variant="outline"
            className="w-full"
            onClick={() => apply(DEFAULT_PUSH_CONFIG)}
          >
            Alles auf Default
          </Button>

          <Button
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Fertig
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default PushSimulationSheet;
