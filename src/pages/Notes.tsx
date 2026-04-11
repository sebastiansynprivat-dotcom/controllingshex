import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
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

export default function Notes() {
  const { user } = useAuth();
  const { platform } = usePlatform();
  const { toast } = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);

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
    fetchTodos();
  }, [user, platform]);

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

  const open = todos.filter((t) => !t.is_done);
  const done = todos.filter((t) => t.is_done);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold text-foreground/90 tracking-wide">Notizen</h1>

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
