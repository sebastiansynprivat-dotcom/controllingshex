import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Loader2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CoachingMemo,
  uploadCoachingMemo,
  deleteCoachingMemo,
  getMemoSignedUrl,
} from "@/lib/coaching";

interface Props {
  coachingId: string;
  cardKey: string;
  isOwner: boolean;
  memo: CoachingMemo | null;
  suggested?: boolean;
  suggestedReason?: string;
  onChange: (memo: CoachingMemo | null) => void;
}

function fmt(ms?: number | null) {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function CoachingMemoBar({ coachingId, cardKey, isOwner, memo, suggested, suggestedReason, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(memo?.audio_url ?? null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startAtRef = useRef<number>(0);
  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setAudioUrl(memo?.audio_url ?? null);
  }, [memo?.id, memo?.audio_url]);

  useEffect(() => {
    // Refresh signed URL if missing but memo exists
    if (memo && !audioUrl) {
      getMemoSignedUrl(memo.audio_path).then((u) => u && setAudioUrl(u)).catch(() => { /* noop */ });
    }
  }, [memo, audioUrl]);

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
          const saved = await uploadCoachingMemo({ coachingId, cardKey, blob, durationMs });
          const url = await getMemoSignedUrl(saved.audio_path);
          const next = { ...saved, audio_url: url } as CoachingMemo;
          setAudioUrl(url);
          onChange(next);
          toast.success("Memo gespeichert");
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

  const stopRec = () => {
    try { recRef.current?.stop(); } catch { /* noop */ }
  };

  const onDelete = async () => {
    if (!memo) return;
    if (!confirm("Memo löschen?")) return;
    try {
      await deleteCoachingMemo(memo);
      setAudioUrl(null);
      onChange(null);
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

  // Chatter view: only render if memo exists
  if (!isOwner && !memo) return null;

  const highlight = isOwner && !memo && suggested;

  return (
    <div
      className={
        "mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 " +
        (highlight
          ? "border-amber-400/50 bg-amber-500/10 shadow-[0_0_0_1px_rgba(251,191,36,0.15)]"
          : "border-amber-500/25 bg-amber-500/5")
      }
    >
      <Mic className={"h-3.5 w-3.5 shrink-0 " + (highlight ? "text-amber-200 animate-pulse" : "text-amber-300")} />
      <span className="text-[10px] uppercase tracking-wider text-amber-200/80 shrink-0">
        {highlight ? (suggestedReason ? `Memo empfohlen · ${suggestedReason}` : "Memo empfohlen") : "Memo vom Boss"}
      </span>

      {audioUrl && (
        <>
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            preload="none"
          />
          <Button size="sm" variant="ghost" onClick={togglePlay} className="h-7 px-2 text-amber-100 hover:bg-amber-500/10">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span className="ml-1 text-[11px] tabular-nums">{fmt(memo?.duration_ms)}</span>
          </Button>
        </>
      )}

      {!audioUrl && !isOwner && (
        <span className="text-[11px] text-white/50">wird geladen…</span>
      )}

      <div className="flex-1" />

      {isOwner && !recording && !uploading && (
        <Button size="sm" variant="ghost" onClick={startRec} className="h-7 px-2 text-amber-200 hover:bg-amber-500/10">
          <Mic className="h-3.5 w-3.5 mr-1" />
          <span className="text-[11px]">{memo ? "Neu aufnehmen" : "Aufnehmen"}</span>
        </Button>
      )}

      {isOwner && recording && (
        <Button size="sm" onClick={stopRec} className="h-7 px-2 bg-rose-500 hover:bg-rose-400 text-white">
          <Square className="h-3 w-3 mr-1 fill-white" />
          <span className="text-[11px] tabular-nums">{fmt(elapsed)}</span>
        </Button>
      )}

      {isOwner && uploading && (
        <div className="flex items-center gap-1 text-[11px] text-white/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lädt…
        </div>
      )}

      {isOwner && memo && !recording && !uploading && (
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-rose-300 hover:bg-rose-500/10">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
