import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pin, PinOff, Pencil, Trash2, Check, X, Wand2 } from "lucide-react";

interface ThreadRowProps {
  id: string;
  title: string;
  pinned: boolean;
  hasSuperPrompt: boolean;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export default function ThreadRow({
  title,
  pinned,
  hasSuperPrompt,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: ThreadRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next.slice(0, 80));
    else setDraft(title);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-white/[0.06] pr-1" data-keep-open>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (cancelRef.current) { cancelRef.current = false; return; }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRef.current = true;
              setDraft(title);
              setEditing(false);
            }
          }}
          className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-[11px] font-light text-foreground/85 focus:outline-none"
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          aria-label="Titel speichern"
          className="p-1.5 rounded-md text-primary/70 hover:text-primary transition-colors"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); cancelRef.current = true; }}
          onClick={() => { setDraft(title); setEditing(false); }}
          aria-label="Abbrechen"
          className="p-1.5 rounded-md text-white/30 hover:text-white/60 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left"
      >
        {pinned ? (
          <Pin className="h-3 w-3 shrink-0 text-primary/70" />
        ) : (
          <MessageSquare className="h-3 w-3 shrink-0 text-white/25" />
        )}
        <span className="truncate text-[11px] font-light text-white/55">{title}</span>
        {hasSuperPrompt && <Wand2 className="h-2.5 w-2.5 shrink-0 text-primary/50" />}
      </button>
      <button
        onClick={onTogglePin}
        aria-label={pinned ? "Loslösen" : "Anpinnen"}
        data-keep-open
        className={`p-1.5 rounded-md transition-all ${
          pinned
            ? "text-primary/70 hover:text-primary"
            : "md:opacity-0 md:group-hover:opacity-100 text-white/25 hover:text-primary"
        }`}
      >
        {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
      </button>
      <button
        onClick={() => setEditing(true)}
        aria-label="Titel bearbeiten"
        data-keep-open
        className="md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-md text-white/25 hover:text-white/70 transition-all"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        onClick={onDelete}
        aria-label="Unterhaltung löschen"
        data-keep-open
        className="md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-md text-white/25 hover:text-red-400 transition-all"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
