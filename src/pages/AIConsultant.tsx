import { useState, useRef, useEffect } from "react";
import { Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/contexts/PlatformContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const quickActions = [
  "Wer ist mein Top-Performer diese Woche?",
  "Wer hat heute massiv abgebaut?",
  "Welche Chatter haben den höchsten Antwort-Verzug?",
  "Gib mir eine Zusammenfassung der letzten 7 Tage.",
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

    try {
      const { data, error } = await supabase.functions.invoke("ai-consultant", {
        body: { messages: newMessages, platform },
      });

      if (error) throw error;
      const reply = data?.reply || "Keine Antwort erhalten.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err: any) {
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
                  <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground/90 prose-headings:font-light prose-headings:tracking-tight prose-p:text-white/50 prose-p:font-light prose-p:leading-relaxed prose-li:text-white/50 prose-li:font-light prose-strong:text-foreground/80 prose-strong:font-medium">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm font-light">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}

          {loading && (
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
