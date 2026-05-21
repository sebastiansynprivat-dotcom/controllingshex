import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";

interface ToolCall {
  name: string;
  args: any;
  result: any;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
}

const quickActions = [
  "Was steht heute an? Welche Memos sind fällig?",
  "Was war zuletzt mit meinen Top-3-Chattern besprochen?",
  "Wer hat heute massiv abgebaut?",
  "Notier: gib Sarah noch 2 Tage für Mass-DMs hoch",
];

export default function AIConsultant() {
  const { platform } = usePlatform();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
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
        }),
      });

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: json.reply || "Keine Antwort erhalten.",
          tool_calls: json.tool_calls || [],
        };
        return next;
      });
    } catch (err: any) {
      setMessages((prev) => prev.slice(0, -1));
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
    <div className="flex flex-col h-full min-h-0">
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
                  Frag deine Daten. Ich analysiere Performance, Trends und gebe dir konkrete Handlungsempfehlungen.
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
                            tc.name === "create_memo" ? `Memo angelegt: ${tc.args?.chatter_name}${tc.args?.follow_up_days ? ` · Reminder in ${tc.args.follow_up_days}d` : ""}` :
                            tc.name === "read_memos" ? `Memos gelesen${tc.args?.chatter_name ? ` (${tc.args.chatter_name})` : ""} → ${tc.result?.memos?.length ?? 0}` :
                            tc.name === "resolve_memo" ? "Memo erledigt" :
                            tc.name === "delete_memo" ? "Memo gelöscht" : tc.name;
                          const ok = tc.result?.ok !== false;
                          return (
                            <div key={idx} className={`flex items-center gap-2 text-[11px] font-light px-2.5 py-1.5 rounded-md border ${ok ? "bg-primary/5 border-primary/15 text-primary/80" : "bg-red-500/5 border-red-500/15 text-red-400/80"}`}>
                              <Wrench className="h-3 w-3 shrink-0" />
                              <span>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.content && (
                      <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground/90 prose-headings:font-light prose-headings:tracking-tight prose-p:text-white/50 prose-p:font-light prose-p:leading-relaxed prose-li:text-white/50 prose-li:font-light prose-strong:text-foreground/80 prose-strong:font-medium">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-light">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}

          {loading && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
            <div className="flex justify-start">
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl px-6 py-4 flex items-center gap-2">
                <span className="h-4 w-4 border border-white/20 border-t-primary/60 rounded-full" style={{ animation: "spin-slow 1s linear infinite" }} />
                <span className="text-xs text-white/25 font-light">Analysiert deine Daten…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-white/[0.04] bg-zinc-950/80 backdrop-blur-2xl">
        <div className="max-w-3xl mx-auto px-3 sm:px-8 py-3 sm:py-5">
          <div className="flex gap-3 items-end">
            <textarea
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
  );
}
