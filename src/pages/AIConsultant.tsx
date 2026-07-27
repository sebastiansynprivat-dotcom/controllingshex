import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Send, Sparkles, Wrench, Plus, Trash2, MessageSquare, Brain, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import ThinkingIndicator from "@/components/ai/ThinkingIndicator";

interface ToolCall {
  name: string;
  args: any;
  result?: any;
  pending?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
}

interface Thread {
  id: string;
  title: string;
  updated_at: string;
}

interface Memory {
  id: string;
  content: string;
  category: string | null;
}

const quickActions = [
  "Was steht heute an? Welche Memos sind fällig?",
  "Was war zuletzt mit meinen Top-3-Chattern besprochen?",
  "Wer hat heute massiv abgebaut?",
  "Notier: gib Sarah noch 2 Tage für Mass-DMs hoch",
];

export default function AIConsultant() {
  const { platform } = usePlatform();
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId?: string }>();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const skipLoadRef = useRef<string | null>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("ai_threads")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false });
    setThreads((data as Thread[]) ?? []);
  }, []);

  const loadMemories = useCallback(async () => {
    const { data } = await supabase
      .from("ai_memories")
      .select("id,content,category")
      .order("created_at", { ascending: false });
    setMemories((data as Memory[]) ?? []);
  }, []);

  useEffect(() => {
    loadThreads();
    loadMemories();
  }, [loadThreads, loadMemories]);

  // Load messages of the routed thread
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    if (skipLoadRef.current === threadId) {
      skipLoadRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("role,content,tool_calls,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        toast.error("Verlauf konnte nicht geladen werden.");
        return;
      }
      setMessages(
        (data ?? []).map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content ?? "",
          tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : [],
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const patchLast = (fn: (m: Message) => Message) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  };

  const newThread = () => {
    setMessages([]);
    navigate("/ai-consultant");
    inputRef.current?.focus();
  };

  const deleteThread = async (id: string) => {
    const { error } = await supabase.from("ai_threads").delete().eq("id", id);
    if (error) {
      toast.error("Löschen fehlgeschlagen.");
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (id === threadId) {
      setMessages([]);
      navigate("/ai-consultant");
    }
  };

  const deleteMemory = async (id: string) => {
    const { error } = await supabase.from("ai_memories").delete().eq("id", id);
    if (error) {
      toast.error("Löschen fehlgeschlagen.");
      return;
    }
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "", tool_calls: [] }]);

    let activeThread = threadId ?? null;

    try {
      if (!activeThread) {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData.user?.id;
        if (!uid) throw new Error("Nicht angemeldet.");
        const { data: created, error: threadErr } = await supabase
          .from("ai_threads")
          .insert({
            user_id: uid,
            platform,
            title: text.trim().replace(/\s+/g, " ").slice(0, 60) || "Neue Unterhaltung",
          })
          .select("id,title,updated_at")
          .single();
        if (threadErr || !created) throw new Error(threadErr?.message ?? "Thread konnte nicht angelegt werden.");
        activeThread = created.id;
        skipLoadRef.current = created.id;
        setThreads((prev) => [created as Thread, ...prev]);
        navigate(`/ai-consultant/${created.id}`, { replace: true });
      }

      const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/ai-consultant`;
      const { data: { session } } = await supabase.auth.getSession();
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? anon}`,
          "apikey": anon,
        },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          platform,
          thread_id: activeThread,
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;
      let sawMemory = false;

      const handle = (evt: any) => {
        if (evt.t === "delta") {
          patchLast((m) => ({ ...m, content: m.content + evt.c }));
        } else if (evt.t === "tool_start") {
          patchLast((m) => ({
            ...m,
            tool_calls: [...(m.tool_calls ?? []), { name: evt.name, args: evt.args, pending: true }],
          }));
        } else if (evt.t === "tool") {
          if (evt.name === "remember" || evt.name === "forget_memory") sawMemory = true;
          patchLast((m) => {
            const tcs = [...(m.tool_calls ?? [])];
            const idx = tcs.findIndex((t) => t.pending && t.name === evt.name);
            const done = { name: evt.name, args: evt.args, result: evt.result, pending: false };
            if (idx >= 0) tcs[idx] = done;
            else tcs.push(done);
            return { ...m, tool_calls: tcs };
          });
        } else if (evt.t === "error") {
          streamError = evt.m;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          try { handle(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
        }
      }

      if (streamError) throw new Error(streamError);

      patchLast((m) => ({
        ...m,
        content: m.content || "Keine Antwort erhalten.",
        tool_calls: (m.tool_calls ?? []).filter((t) => !t.pending),
      }));

      if (sawMemory) loadMemories();
      loadThreads();
    } catch (err: any) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
        return prev;
      });
      toast.error(err.message || "Fehler beim Senden.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Thread list */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-white/[0.04] bg-black/20">
        <div className="p-3 space-y-2">
          <button
            onClick={newThread}
            className="w-full flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-3 py-2.5 text-xs text-primary font-light hover:bg-primary/15 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Neue Unterhaltung
          </button>
          <button
            onClick={() => { setMemoriesOpen(true); loadMemories(); }}
            className="w-full flex items-center gap-2 rounded-xl bg-white/[0.02] border border-white/[0.05] px-3 py-2.5 text-xs text-white/45 font-light hover:text-white/70 hover:bg-white/[0.04] transition-colors"
          >
            <Brain className="h-3.5 w-3.5" /> Gedächtnis ({memories.length})
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {threads.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-white/20 font-light">Noch keine Unterhaltungen</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                t.id === threadId ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <button
                onClick={() => navigate(`/ai-consultant/${t.id}`)}
                className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left"
              >
                <MessageSquare className="h-3 w-3 shrink-0 text-white/25" />
                <span className="truncate text-[11px] font-light text-white/55">{t.title}</span>
              </button>
              <button
                onClick={() => deleteThread(t.id)}
                aria-label="Unterhaltung löschen"
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-white/25 hover:text-red-400 transition-all"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-3 sm:px-8 py-6 sm:py-12 space-y-6 sm:space-y-8">
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="space-y-10 pt-16"
              >
                <div className="text-center space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary/50" />
                  </div>
                  <h1 className="text-2xl font-extralight text-foreground tracking-tight">AI Consultant</h1>
                  <p className="text-sm text-white/25 font-light max-w-md mx-auto">
                    Frag deine Daten. Ich analysiere Performance, Trends und gebe dir konkrete Handlungsempfehlungen — und merke mir, was du mir sagst.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {quickActions.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-left rounded-xl bg-white/[0.02] border border-white/[0.05] px-5 py-4 text-xs text-white/40 font-light hover:bg-white/[0.04] hover:border-primary/10 hover:text-white/60 transition-all duration-500"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 sm:px-6 py-3 sm:py-4 ${
                    msg.role === "user"
                      ? "bg-primary/8 border border-primary/12 text-foreground/90"
                      : "bg-white/[0.02] border border-white/[0.06] text-foreground/80"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="space-y-3">
                      {msg.tool_calls && msg.tool_calls.length > 0 && (
                        <div className="space-y-1.5">
                          {msg.tool_calls.map((tc, idx) => {
                            const label =
                              tc.name === "remember" ? `Gemerkt: ${tc.args?.content ?? ""}` :
                              tc.name === "forget_memory" ? "Gedächtnis-Eintrag gelöscht" :
                              tc.name === "create_memo" ? `Memo angelegt: ${tc.args?.chatter_name}${tc.args?.follow_up_days ? ` · Reminder in ${tc.args.follow_up_days}d` : ""}` :
                              tc.name === "read_memos" ? `Memos gelesen${tc.args?.chatter_name ? ` (${tc.args.chatter_name})` : ""}${tc.result ? ` → ${tc.result?.memos?.length ?? 0}` : ""}` :
                              tc.name === "resolve_memo" ? "Memo erledigt" :
                              tc.name === "delete_memo" ? "Memo gelöscht" :
                              tc.name === "get_live_status" ? `Echtzeit-Daten${tc.args?.chatter_name ? ` (${tc.args.chatter_name})` : ""}${tc.result ? ` → ${tc.result?.count ?? 0} Chatter` : ""}` :
                              tc.name === "get_chatter_history" ? `Verlauf: ${tc.args?.chatter_name ?? ""}${tc.result ? ` → ${tc.result?.count ?? 0} Tage` : ""}` :
                              tc.name === "get_account_history" ? `Account-Chronologie: ${tc.args?.account ?? ""}` :
                              tc.name;
                            const ok = tc.result?.ok !== false;
                            return (
                              <motion.div
                                key={idx}
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.4, delay: idx * 0.05, ease: [0.32, 0.72, 0, 1] }}
                                className={`relative overflow-hidden flex items-center gap-2.5 text-[11px] font-light px-3 py-2 rounded-lg border backdrop-blur-sm ${tc.pending ? "lux-thinking text-white/45" : ok ? "bg-primary/[0.06] border-primary/15 text-primary/80 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]" : "bg-red-500/[0.06] border-red-500/15 text-red-400/80"}`}
                              >
                                {tc.pending
                                  ? <span className="lux-orb" />
                                  : <Wrench className="h-3 w-3 shrink-0" />}
                                <span className={tc.pending ? "lux-shimmer-text" : ""}>{label}</span>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                      {msg.content && (
                        <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground/90 prose-headings:font-light prose-headings:tracking-tight prose-p:text-white/50 prose-p:font-light prose-p:leading-relaxed prose-li:text-white/50 prose-li:font-light prose-strong:text-foreground/80 prose-strong:font-medium">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                          {loading && i === messages.length - 1 && (
                            <span className="inline-block align-middle -mt-0.5 ml-0.5 h-3.5 w-[2px] rounded-full bg-primary/70 animate-pulse" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm font-light">{msg.content}</p>
                  )}
                </div>
              </motion.div>
            ))}

            {loading && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && !(messages[messages.length - 1]?.tool_calls?.length) && (
              <ThinkingIndicator />
            )}

            {loading && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && !!messages[messages.length - 1]?.tool_calls?.length && (
              <ThinkingIndicator label="Werte Ergebnisse aus" />
            )}
          </div>
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-white/[0.04] bg-zinc-950/80 backdrop-blur-2xl">
          <div className="max-w-3xl mx-auto px-3 sm:px-8 py-3 sm:py-5">
            <div className="flex gap-3 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Frag den AI Consultant…"
                rows={1}
                className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-3.5 text-sm text-foreground/80 font-light placeholder:text-white/15 resize-none focus:outline-none focus:border-primary/20 transition-colors duration-300"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="px-4 py-3.5 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Memory panel */}
      {memoriesOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setMemoriesOpen(false)} />
          <div className="relative w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
              <Brain className="h-4 w-4 text-primary/70" />
              <h3 className="text-sm font-light text-foreground/85 flex-1">Was sich der Consultant gemerkt hat</h3>
              <button onClick={() => setMemoriesOpen(false)} className="p-1.5 rounded-md text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {memories.length === 0 && (
                <p className="text-xs text-white/25 font-light py-6 text-center">Noch nichts gemerkt.</p>
              )}
              {memories.map((m) => (
                <div key={m.id} className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/60 font-light leading-relaxed">{m.content}</p>
                    {m.category && (
                      <span className="text-[10px] text-primary/60 font-light">{m.category}</span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteMemory(m.id)}
                    aria-label="Eintrag löschen"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-white/25 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
