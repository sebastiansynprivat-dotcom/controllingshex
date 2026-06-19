import { useEffect, useRef, useState } from "react";

export interface FakeCounterConfig {
  startValue: number;
  min: number;
  max: number;
  tickMinMs: number;
  tickMaxMs: number;
  stepMin: number;
  stepMax: number;
  /** -1..1 - bias toward up (positive) or down (negative) */
  trend: number;
  /** 0..1 - probability of a larger jump */
  volatility: number;
  paused: boolean;
}

export interface PushFakeConfig {
  chatters: FakeCounterConfig;
  users: FakeCounterConfig;
}

export const DEFAULT_PUSH_CONFIG: PushFakeConfig = {
  chatters: {
    startValue: 42,
    min: 18,
    max: 95,
    tickMinMs: 1000,
    tickMaxMs: 4000,
    stepMin: 2,
    stepMax: 8,
    trend: 0,
    volatility: 0.1,
    paused: false,
  },
  users: {
    startValue: 1840,
    min: 600,
    max: 4200,
    tickMinMs: 1000,
    tickMaxMs: 3500,
    stepMin: 3,
    stepMax: 12,
    trend: 0,
    volatility: 0.15,
    paused: false,
  },
};

const STORAGE_KEY = "push.fake.config.v1";

export function loadPushConfig(): PushFakeConfig {
  if (typeof window === "undefined") return DEFAULT_PUSH_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PUSH_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      chatters: { ...DEFAULT_PUSH_CONFIG.chatters, ...parsed.chatters },
      users: { ...DEFAULT_PUSH_CONFIG.users, ...parsed.users },
    };
  } catch {
    return DEFAULT_PUSH_CONFIG;
  }
}

export function savePushConfig(cfg: PushFakeConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

const HISTORY_LEN = 60;

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export function useFakeCounter(config: FakeCounterConfig) {
  const [value, setValue] = useState<number>(
    clamp(config.startValue, config.min, config.max),
  );
  const [history, setHistory] = useState<number[]>([
    clamp(config.startValue, config.min, config.max),
  ]);
  const valueRef = useRef(value);
  const cfgRef = useRef(config);
  const timerRef = useRef<number | null>(null);

  // Update refs when config changes (but don't reset value unless start changes drastically)
  useEffect(() => {
    cfgRef.current = config;
    // Re-clamp current value to new bounds
    setValue((v) => {
      const c = clamp(v, config.min, config.max);
      valueRef.current = c;
      return c;
    });
  }, [config]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const scheduleNext = () => {
      const cfg = cfgRef.current;
      if (cfg.paused) {
        timerRef.current = window.setTimeout(scheduleNext, 800);
        return;
      }
      const tMin = reduced ? Math.max(4000, cfg.tickMinMs) : cfg.tickMinMs;
      const tMax = reduced ? Math.max(8000, cfg.tickMaxMs) : cfg.tickMaxMs;
      const wait = randInt(Math.min(tMin, tMax), Math.max(tMin, tMax));

      timerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        const cfg2 = cfgRef.current;
        const sMin = Math.max(0, Math.min(cfg2.stepMin, cfg2.stepMax));
        const sMax = Math.max(sMin, cfg2.stepMax);
        let step = randInt(sMin, sMax);
        // volatility jump
        if (Math.random() < cfg2.volatility) {
          step = step + randInt(sMax, sMax * 3);
        }
        if (reduced) step = Math.max(1, Math.floor(step / 2));

        // Direction influenced by trend and distance to bounds
        const range = Math.max(1, cfg2.max - cfg2.min);
        const mid = (cfg2.max + cfg2.min) / 2;
        const distFromMid = (valueRef.current - mid) / (range / 2); // -1..1
        // Bias toward mid to keep oscillating; plus user trend
        const upProb = clamp(0.5 - distFromMid * 0.25 + cfg2.trend * 0.25, 0.05, 0.95);
        const dir = Math.random() < upProb ? 1 : -1;

        const next = clamp(valueRef.current + dir * step, cfg2.min, cfg2.max);
        setValue(next);
        setHistory((h) => {
          const out = [...h, next];
          if (out.length > HISTORY_LEN) out.splice(0, out.length - HISTORY_LEN);
          return out;
        });
        scheduleNext();
      }, wait) as unknown as number;
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reroll = () => {
    const cfg = cfgRef.current;
    const next = randInt(cfg.min, cfg.max);
    setValue(next);
    valueRef.current = next;
    setHistory((h) => [...h, next].slice(-HISTORY_LEN));
  };

  return { value, history, reroll };
}
