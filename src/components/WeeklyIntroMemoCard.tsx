import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Loader2, Play, Pause, CheckCircle2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  PendingWeeklyMemo,
  getPendingWeeklyMemo,
  uploadPendingWeeklyMemo,
  deletePendingWeeklyMemo,
} from "@/lib/coaching";

function fmt(ms?: number | null) {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

interface Props {
  onChange?: (memo: PendingWeeklyMemo | null) => void;
  /** Bump this to force reload after a report has been generated (consume). */
  reloadKey?: number;
}

export default function WeeklyIntroMemoCard({ onChange, reloadKey }: Props) {
  const [memo, setMemo] = useState<PendingWeeklyMemo | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startAtRef = useRef<number>(0);
  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setLoading(true);
    getPendingWeeklyMemo()
      .then((m) => setMemo(m))
      .catch(() => { /* noop */ })
      .finally(() => setLoading(false));
  }, [reloadKey]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { recRef.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
  }, []);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const durationMs = Date.now() - startAtRef.current;
        const blob = new Blob(chunksRef.current, { type: mime });
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setElapsed(0);
        if (blob.size < 500) {
          toast.error("Aufnahme zu kurz");
          return;
        }
        setUploading(true);
        try {
          const saved = await uploadPendingWeeklyMemo({ blob, durationMs });
          setMemo(saved);
          onChange?.(saved);
          toast.success("Wochen-Memo bereit für nächsten Report");
        } catch (e: any) {
          toast.error(e?.message ?? "Upload fehlgeschlagen");
        } finally {
          setUploading(false);
        }
      };
      rec.start();
      recRef.current = rec;
      startAtRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Date.now() - startAtRef.current), 250);
    } catch (e: any) {
      toast.error(e?.message ?? "Kein Mikrofonzugriff");
    }
  };

  const stopRec = () => { try { recRef.current?.stop(); } catch { /* noop */ } };

  const onDelete = async () => {
    if (!memo) return;
    if (!confirm("Wochen-Memo löschen?")) return;
    try {
      await deletePendingWeeklyMemo(memo);
      setMemo(null);
      onChange?.(null);
      toast.success("Memo gelöscht");
    } catch (e: any) {
      toast.error(e?.message ?? "Löschen fehlgeschlagen");
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => { /* noop */ }); setPlaying(true); }
    else { el.pause(); setPlaying(false); }
  };

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
          <Megaphone className="h-4 w-4 text-amber-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-amber-100/90">Wochen-Memo für nächsten Report</div>
          <div className="text-[11px] text-amber-100/50 font-light">
            {memo
              ? "Wird als Intro in den nächsten generierten Report eingebaut. Danach automatisch verbraucht."
              : "Nimm einmal auf — läuft automatisch in den nächsten Report."}
          </div>
        </div>
        {memo && (
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-300/80 shrink-0 mt-1">
            <CheckCircle2 className="h-3 w-3" /> Bereit
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> lädt…
          </div>
        ) : (
          <>
            {memo?.audio_url && (
              <>
                <audio
                  ref={audioRef}
                  src={memo.audio_url}
                  onEnded={() => setPlaying(false)}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  preload="none"
                />
                <Button size="sm" variant="ghost" onClick={togglePlay} className="h-8 px-2.5 text-amber-100 hover:bg-amber-500/10">
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="ml-1 text-[11px] tabular-nums">{fmt(memo?.duration_ms)}</span>
                </Button>
              </>
            )}

            <div className="flex-1" />

            {!recording && !uploading && (
              <Button
                size="sm"
                variant="outline"
                onClick={startRec}
                className="h-8 px-3 border-amber-500/30 bg-amber-500/5 text-amber-100 hover:bg-amber-500/10"
              >
                <Mic className="h-3.5 w-3.5 mr-1.5" />
                <span className="text-[11px]">{memo ? "Neu aufnehmen" : "Aufnehmen"}</span>
              </Button>
            )}

            {recording && (
              <Button size="sm" onClick={stopRec} className="h-8 px-3 bg-rose-500 hover:bg-rose-400 text-white">
                <Square className="h-3 w-3 mr-1.5 fill-white" />
                <span className="text-[11px] tabular-nums">{fmt(elapsed)}</span>
              </Button>
            )}

            {uploading && (
              <div className="flex items-center gap-1 text-[11px] text-white/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lädt…
              </div>
            )}

            {memo && !recording && !uploading && (
              <Button size="sm" variant="ghost" onClick={onDelete} className="h-8 w-8 p-0 text-rose-300 hover:bg-rose-500/10">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
