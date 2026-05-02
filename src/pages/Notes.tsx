import { useState, useEffect } from "react";
import { Plus, Trash2, Lock, LockOpen, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatform } from "@/contexts/PlatformContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

interface Todo {
  id: string;
  text: string;
  is_done: boolean;
  created_at: string;
}

// Lightweight hash via SubtleCrypto (SHA-256)
async function hashPassword(pw: string): Promise<string> {
  const buf = new TextEncoder().encode(pw);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const STORAGE_KEY = "notes_pw_hash_v1";

export default function Notes() {
  const { user } = useAuth();
  const { platform } = usePlatform();
  const { toast } = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);

  // Lock state
  const [storedHash, setStoredHash] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Load stored hash on mount
  useEffect(() => {
    const h = localStorage.getItem(STORAGE_KEY);
    setStoredHash(h);
  }, []);

  const fetchTodos = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("todos")
      .select("id, text, is_done, created_at")
      .eq("platform", platform)
      .order("is_done", { ascending: true })
      .order("created_at", { ascending: false });

    if (!error && data) setTodos(data);
    setLoading(false);
  };

  useEffect(() => {
    if (unlocked) fetchTodos();
  }, [user, platform, unlocked]);

  const addTodo = async () => {
    const trimmed = newText.trim();
    if (!trimmed || !user) return;

    const { error } = await supabase.from("todos").insert({
      text: trimmed,
      user_id: user.id,
      platform,
    });

    if (error) {
      toast({ title: "Fehler", description: "Konnte nicht gespeichert werden.", variant: "destructive" });
      return;
    }
    setNewText("");
    fetchTodos();
  };

  const toggleTodo = async (id: string, current: boolean) => {
    await supabase.from("todos").update({ is_done: !current }).eq("id", id);
    fetchTodos();
  };

  const deleteTodo = async (id: string) => {
    await supabase.from("todos").delete().eq("id", id);
    fetchTodos();
  };

  const handleSetPassword = async () => {
    if (pwInput.length < 4) {
      toast({ title: "Zu kurz", description: "Mindestens 4 Zeichen.", variant: "destructive" });
      return;
    }
    if (pwInput !== pwConfirm) {
      toast({ title: "Passwörter stimmen nicht überein", variant: "destructive" });
      return;
    }
    setVerifying(true);
    const hash = await hashPassword(pwInput);
    localStorage.setItem(STORAGE_KEY, hash);
    setStoredHash(hash);
    setUnlocked(true);
    setPwInput("");
    setPwConfirm("");
    setVerifying(false);
    toast({ title: "Passwort gesetzt", description: "Notizen sind jetzt geschützt." });
  };

  const handleUnlock = async () => {
    if (!pwInput || !storedHash) return;
    setVerifying(true);
    const hash = await hashPassword(pwInput);
    if (hash === storedHash) {
      setUnlocked(true);
      setPwInput("");
    } else {
      toast({ title: "Falsches Passwort", variant: "destructive" });
    }
    setVerifying(false);
  };

  const handleLock = () => {
    setUnlocked(false);
    setTodos([]);
    setLoading(true);
  };

  const handleResetPassword = () => {
    if (!confirm("Passwort wirklich zurücksetzen? Du musst beim nächsten Öffnen ein neues setzen. Die Notizen selbst bleiben erhalten.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setStoredHash(null);
    setUnlocked(false);
    setPwInput("");
    setPwConfirm("");
  };

  // ---------- LOCKED VIEWS ----------
  if (!unlocked) {
    const isFirstTime = !storedHash;
    return (
      <div className="p-6 max-w-sm mx-auto pt-20">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="h-14 w-14 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <Lock className="h-5 w-5 text-white/40" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-light text-foreground/80 tracking-wide">
              {isFirstTime ? "Passwort festlegen" : "Notizen gesperrt"}
            </h1>
            <p className="text-xs text-white/30 font-light">
              {isFirstTime
                ? "Wähle ein Passwort um deine Notizen zu schützen"
                : "Gib dein Passwort ein um fortzufahren"}
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              isFirstTime ? handleSetPassword() : handleUnlock();
            }}
            className="w-full space-y-3"
          >
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder="Passwort"
                autoFocus
                className="bg-white/[0.03] border-white/[0.06] text-sm placeholder:text-white/20 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50"
              >
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>

            {isFirstTime && (
              <Input
                type={showPw ? "text" : "password"}
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                placeholder="Passwort bestätigen"
                className="bg-white/[0.03] border-white/[0.06] text-sm placeholder:text-white/20"
              />
            )}

            <Button
              type="submit"
              disabled={verifying || !pwInput.trim() || (isFirstTime && !pwConfirm.trim())}
              className="w-full bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 font-light text-xs tracking-wider"
            >
              {verifying ? "..." : isFirstTime ? "Passwort setzen" : "Entsperren"}
            </Button>
          </form>

          {!isFirstTime && (
            <button
              onClick={handleResetPassword}
              className="text-[11px] text-white/20 hover:text-white/40 transition-colors underline-offset-4 hover:underline"
            >
              Passwort vergessen? Zurücksetzen
            </button>
          )}

          <p className="text-[10px] text-white/15 font-light leading-relaxed pt-4">
            Das Passwort wird nur lokal in diesem Browser gespeichert.
            Auf anderen Geräten musst du es neu setzen.
          </p>
        </div>
      </div>
    );
  }

  // ---------- UNLOCKED VIEW ----------
  const open = todos.filter((t) => !t.is_done);
  const done = todos.filter((t) => t.is_done);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground/90 tracking-wide">Texte</h1>
        <button
          onClick={handleLock}
          className="text-white/30 hover:text-white/60 transition-colors flex items-center gap-1.5 text-[11px] tracking-wider uppercase"
          title="Sperren"
        >
          <LockOpen className="h-3.5 w-3.5" />
          Sperren
        </button>
      </div>

      {/* Add */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTodo();
        }}
        className="flex gap-2"
      >
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Neue Aufgabe …"
          className="flex-1 bg-white/[0.03] border-white/[0.06] text-sm placeholder:text-white/20"
        />
        <Button type="submit" size="icon" variant="ghost" className="shrink-0 text-primary hover:bg-primary/10">
          <Plus className="h-4 w-4" />
        </Button>
      </form>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Open */}
          <ul className="space-y-1">
            {open.map((t) => (
              <TodoItem key={t.id} todo={t} onToggle={toggleTodo} onDelete={deleteTodo} />
            ))}
            {open.length === 0 && (
              <p className="text-white/20 text-sm py-4 text-center">Keine offenen Aufgaben</p>
            )}
          </ul>

          {/* Done */}
          {done.length > 0 && (
            <div className="space-y-1 pt-4 border-t border-white/[0.04]">
              <p className="text-[11px] uppercase tracking-widest text-white/20 mb-2">Erledigt</p>
              {done.map((t) => (
                <TodoItem key={t.id} todo={t} onToggle={toggleTodo} onDelete={deleteTodo} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TodoItem({
  todo,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 group px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
      <Checkbox
        checked={todo.is_done}
        onCheckedChange={() => onToggle(todo.id, todo.is_done)}
        className="border-white/15 data-[state=checked]:bg-primary/80 data-[state=checked]:border-primary/60"
      />
      <span
        className={`flex-1 text-sm transition-colors ${
          todo.is_done ? "line-through text-white/20" : "text-white/70"
        }`}
      >
        {todo.text}
      </span>
      <button
        onClick={() => onDelete(todo.id)}
        className="opacity-0 group-hover:opacity-100 text-white/15 hover:text-red-400/60 transition-all"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
