import { useState, useEffect, useMemo } from "react";
import { Plus, Pencil, Trash2, Save, X, CalendarIcon, DollarSign, Search, AlertTriangle, ChevronDown, Database } from "lucide-react";
import { detectModelTroubles, type ModelTrouble } from "@/lib/model-tracking";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ModelPerformanceSlideOver from "@/components/ModelPerformanceSlideOver";
import { LineChart as LineChartIcon, Sparkles } from "lucide-react";
import ModelArchetypePanel, {
  type ModelAttributes,
  AGE_LABELS, BODY_LABELS, HAIR_LABELS, STYLE_LABELS,
} from "@/components/ModelArchetypePanel";

interface Model {
  id: string;
  model_name: string;
  follower_count: number;
  platform: string;
  created_at: string;
  email?: string | null;
  password?: string | null;
  profile_url?: string | null;
  profile_image_url?: string | null;
}

type ArchetypeFilter = {
  age?: string;
  body?: string;
  hair?: string;
  style?: string;
};

interface ModelRevenue {
  totalRevenue: number;
  days: number;
}

type PeriodKey = "7" | "14" | "30" | "90" | "custom";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "7", label: "7 Tage" },
  { key: "14", label: "14 Tage" },
  { key: "30", label: "30 Tage" },
  { key: "90", label: "90 Tage" },
  { key: "custom", label: "Custom" },
];

function formatEur(v: number) {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function capitalizeName(raw: string): string {
  return raw.toLocaleLowerCase("de-DE");
}

export default function Models() {
  const { platform } = usePlatform();
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [newName, setNewName] = useState("");
  const [newFollowers, setNewFollowers] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newProfileUrl, setNewProfileUrl] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editFollowers, setEditFollowers] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editProfileUrl, setEditProfileUrl] = useState("");
  const [troubleFilter, setTroubleFilter] = useState(false);
  const [troubles, setTroubles] = useState<ModelTrouble[]>([]);
  const [showArchetypeFilter, setShowArchetypeFilter] = useState(false);

  // Revenue filter state
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const [revenueFilter, setRevenueFilter] = useState<"all" | "earning" | "zero">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [modelRevenues, setModelRevenues] = useState<Record<string, ModelRevenue>>({});
  const [perfModelName, setPerfModelName] = useState<string | null>(null);
  const [attributesByModel, setAttributesByModel] = useState<Record<string, ModelAttributes>>({});
  const [archetypeFilter, setArchetypeFilter] = useState<ArchetypeFilter>({});

  const dateRange = useMemo(() => {
    if (period === "custom") {
      return {
        from: customFrom ? customFrom.toISOString().split("T")[0] : null,
        to: customTo ? customTo.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      };
    }
    const days = parseInt(period);
    const from = new Date();
    from.setDate(from.getDate() - days);
    return {
      from: from.toISOString().split("T")[0],
      to: new Date().toISOString().split("T")[0],
    };
  }, [period, customFrom, customTo]);

  const fetchModels = async () => {
    const { data } = await supabase
      .from("models")
      .select("*")
      .eq("platform", platform)
      .order("created_at", { ascending: true });
    if (data) setModels(data);
  };

  // Load revenue data from chatter_history grouped by account
  useEffect(() => {
    if (models.length === 0 || !dateRange.from) {
      setModelRevenues({});
      return;
    }

    const modelNames = models.map((m) => m.model_name);

    const loadRevenues = async () => {
      const { data } = await supabase
        .from("chatter_history")
        .select("account, revenue_today, analysis_date")
        .eq("platform", platform)
        .in("account", modelNames)
        .gte("analysis_date", dateRange.from!)
        .lte("analysis_date", dateRange.to);

      const revMap: Record<string, ModelRevenue> = {};
      if (data) {
        for (const row of data) {
          const acc = (row.account || "").trim();
          if (!acc) continue;
          if (!revMap[acc]) revMap[acc] = { totalRevenue: 0, days: 0 };
          revMap[acc].totalRevenue += Number(row.revenue_today) || 0;
          revMap[acc].days++;
        }
      }
      setModelRevenues(revMap);
    };

    loadRevenues();
  }, [models, platform, dateRange]);

  useEffect(() => {
    fetchModels();
    setEditId(null);
  }, [platform]);

  const loadAttributes = async (modelIds: string[]) => {
    if (modelIds.length === 0) {
      setAttributesByModel({});
      return;
    }
    const { data } = await supabase
      .from("model_attributes")
      .select("*")
      .in("model_id", modelIds);
    const map: Record<string, ModelAttributes> = {};
    (data ?? []).forEach((a: ModelAttributes) => { map[a.model_id] = a; });
    setAttributesByModel(map);
  };

  useEffect(() => {
    loadAttributes(models.map((m) => m.id));
  }, [models]);

  const archetypeStats = useMemo(() => {
    // Average daily revenue per archetype value
    const buckets: Record<string, Record<string, { rev: number; count: number }>> = {
      age: {}, body: {}, hair: {}, style: {},
    };
    for (const m of models) {
      const a = attributesByModel[m.id];
      const r = modelRevenues[m.model_name];
      if (!a || !r || r.days === 0) continue;
      const perDay = r.totalRevenue / r.days;
      const add = (cat: keyof typeof buckets, key?: string | null) => {
        if (!key) return;
        if (!buckets[cat][key]) buckets[cat][key] = { rev: 0, count: 0 };
        buckets[cat][key].rev += perDay;
        buckets[cat][key].count += 1;
      };
      add("age", a.age_group);
      add("body", a.body_type);
      add("hair", a.hair_color);
      add("style", a.style);
    }
    return buckets;
  }, [models, attributesByModel, modelRevenues]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase("de-DE");
    return models.filter((m) => {
      if (q && !m.model_name.toLocaleLowerCase("de-DE").includes(q)) return false;
      if (revenueFilter !== "all") {
        const rev = modelRevenues[m.model_name];
        if (revenueFilter === "earning" && !(rev && rev.totalRevenue > 0)) return false;
        if (revenueFilter === "zero" && rev && rev.totalRevenue > 0) return false;
      }
      const a = attributesByModel[m.id];
      if (archetypeFilter.age && a?.age_group !== archetypeFilter.age) return false;
      if (archetypeFilter.body && a?.body_type !== archetypeFilter.body) return false;
      if (archetypeFilter.hair && a?.hair_color !== archetypeFilter.hair) return false;
      if (archetypeFilter.style && a?.style !== archetypeFilter.style) return false;
      return true;
    });
  }, [models, revenueFilter, modelRevenues, searchQuery, attributesByModel, archetypeFilter]);

  const addModel = async () => {
    if (!newName.trim()) return;
    if (!user?.id) {
      toast.error("Nicht eingeloggt");
      return;
    }
    const { error } = await supabase.from("models").insert({
      model_name: capitalizeName(newName),
      follower_count: parseInt(newFollowers) || 0,
      platform,
      user_id: user.id,
      email: newEmail.trim() || null,
      password: newPassword.trim() || null,
    });
    if (error) {
      console.error("[addModel] insert error:", error);
      toast.error(`Fehler: ${error.message}`);
      return;
    }
    toast.success(`Model hinzugefügt`);
    setNewName("");
    setNewFollowers("");
    setNewEmail("");
    setNewPassword("");
    fetchModels();
  };

  const startEdit = (m: Model) => {
    setEditId(m.id);
    setEditName(m.model_name);
    setEditFollowers(String(m.follower_count));
    setEditEmail(m.email || "");
    setEditPassword(m.password || "");
  };

  const saveEdit = async () => {
    if (!editId || !editName.trim()) return;
    const { error } = await supabase.from("models").update({
      model_name: capitalizeName(editName),
      follower_count: parseInt(editFollowers) || 0,
      email: editEmail.trim() || null,
      password: editPassword.trim() || null,
    }).eq("id", editId);
    if (error) { toast.error("Fehler beim Speichern"); return; }
    toast.success("Aktualisiert");
    setEditId(null);
    fetchModels();
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const { error } = await supabase.from("models").delete().eq("id", deleteConfirmId);
    if (error) { toast.error("Fehler beim Löschen"); return; }
    toast.success("Gelöscht");
    setDeleteConfirmId(null);
    fetchModels();
  };

  const totalRevAll = Object.values(modelRevenues).reduce((s, r) => s + r.totalRevenue, 0);
  const earningCount = models.filter((m) => modelRevenues[m.model_name]?.totalRevenue > 0).length;

  return (
    <>
    <AnimatePresence mode="wait">
      <motion.div
        key={platform}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-4xl mx-auto space-y-8 sm:space-y-10"
      >
        <div>
          <h1 className="text-2xl font-extralight tracking-tight text-foreground">
            Models & Follower
          </h1>
          <p className="text-[11px] text-white/25 mt-1.5 font-light tracking-wider uppercase">
            {platform} · {models.length} Models
          </p>
        </div>

        {/* Add New */}
        <div className="premium-card rounded-2xl p-5 sm:p-8">
          <h2 className="text-[11px] gold-text-subtle mb-4 sm:mb-5 tracking-[0.2em] uppercase font-medium">Neues Model</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(capitalizeName(e.target.value))}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
            />
            <Input
              placeholder="Follower"
              type="number"
              value={newFollowers}
              onChange={(e) => setNewFollowers(e.target.value)}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
            />
            <Input
              placeholder="E-Mail"
              type="email"
              autoComplete="off"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
            />
            <Input
              placeholder="Passwort"
              type="text"
              autoComplete="off"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-white/[0.03] border-white/[0.06] text-foreground placeholder:text-white/20 font-light text-sm"
            />
          </div>
          <div className="flex justify-end mt-4">
            <Button
              onClick={addModel}
              className="premium-chip bg-white/[0.04] hover:bg-white/[0.07] text-foreground/80 border border-white/[0.08] hover:border-primary/25 font-light text-[12px] tracking-wider transition-all duration-300 shrink-0 active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Hinzufügen
            </Button>
          </div>
        </div>

        {/* Revenue Filter Bar */}
        <div className="premium-card rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-[11px] gold-text-subtle font-medium tracking-[0.2em] uppercase">Umsatz-Filter</span>
            </div>
            <div className="text-right">
              <span className="text-base font-extralight gold-text tracking-tight tabular-nums">{formatEur(totalRevAll)}</span>
              <span className="text-[10px] text-white/25 ml-2 font-light">{earningCount}/{models.length} aktiv</span>
            </div>
          </div>

          {/* Period Pills */}
          <div className="flex flex-wrap gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriod(opt.key)}
                className={cn(
                  "premium-chip px-3 py-1.5 rounded-lg text-[11px] font-light tracking-wide transition-all duration-300 border whitespace-nowrap active:scale-[0.97]",
                  period === opt.key
                    ? "bg-primary/12 border-primary/35 text-primary"
                    : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05] hover:border-white/[0.1]"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range */}
          {period === "custom" && (
            <div className="flex flex-wrap gap-3 items-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-9 px-3 text-xs font-light bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]",
                      !customFrom && "text-white/30"
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 mr-2 text-white/25" />
                    {customFrom ? format(customFrom, "dd.MM.yyyy") : "Von"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customFrom}
                    onSelect={setCustomFrom}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-white/20 text-xs">–</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-9 px-3 text-xs font-light bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]",
                      !customTo && "text-white/30"
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 mr-2 text-white/25" />
                    {customTo ? format(customTo, "dd.MM.yyyy") : "Bis"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customTo}
                    onSelect={setCustomTo}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Earning Status Filter */}
          <div className="flex gap-2">
            {([
              { key: "all" as const, label: "Alle" },
              { key: "earning" as const, label: "Mit Umsatz" },
              { key: "zero" as const, label: "Ohne Umsatz" },
            ]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setRevenueFilter(opt.key)}
                className={cn(
                  "premium-chip px-3 py-1.5 rounded-lg text-[11px] font-light tracking-wide transition-all duration-300 border whitespace-nowrap active:scale-[0.97]",
                  revenueFilter === opt.key
                    ? opt.key === "earning"
                      ? "bg-emerald-500/12 border-emerald-500/35 text-emerald-300"
                      : opt.key === "zero"
                      ? "bg-red-500/12 border-red-500/35 text-red-300"
                      : "bg-white/[0.07] border-white/[0.14] text-white/80"
                    : "bg-white/[0.03] border-white/[0.06] text-white/45 hover:text-white/70 hover:bg-white/[0.05] hover:border-white/[0.1]"
                )}
              >
                {opt.label}
                {opt.key === "earning" && <span className="ml-1 text-[10px] opacity-60">{earningCount}</span>}
                {opt.key === "zero" && <span className="ml-1 text-[10px] opacity-60">{models.length - earningCount}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25 pointer-events-none" />
          <Input
            placeholder="Model suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 premium-card text-foreground placeholder:text-white/25 font-light text-sm h-10 border-0"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              aria-label="Suche löschen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Archetyp-Filter */}
        {Object.values(attributesByModel).length > 0 && (
          <div className="premium-card rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-[11px] gold-text-subtle font-medium tracking-[0.2em] uppercase">Archetyp-Filter</span>
              {(archetypeFilter.age || archetypeFilter.body || archetypeFilter.hair || archetypeFilter.style) && (
                <button
                  onClick={() => setArchetypeFilter({})}
                  className="ml-auto text-[10px] text-white/30 hover:text-white/60 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            {([
              { cat: "age" as const, labels: AGE_LABELS, title: "Alter" },
              { cat: "body" as const, labels: BODY_LABELS, title: "Körper" },
              { cat: "hair" as const, labels: HAIR_LABELS, title: "Haare" },
              { cat: "style" as const, labels: STYLE_LABELS, title: "Stil" },
            ]).map(({ cat, labels, title }) => {
              const stats = archetypeStats[cat];
              const keys = Object.keys(labels).filter((k) => stats[k]);
              if (keys.length === 0) return null;
              return (
                <div key={cat} className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-white/30 font-light">{title}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {keys.map((k) => {
                      const s = stats[k];
                      const avg = s.rev / s.count;
                      const active = archetypeFilter[cat] === k;
                      return (
                        <button
                          key={k}
                          onClick={() => setArchetypeFilter((f) => ({ ...f, [cat]: active ? undefined : k }))}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-[10px] font-light tracking-wide border transition-all duration-300 active:scale-[0.97]",
                            active
                              ? "bg-primary/15 border-primary/40 text-primary"
                              : "bg-white/[0.03] border-white/[0.06] text-white/55 hover:text-white/85 hover:border-white/[0.12]"
                          )}
                        >
                          {labels[k]} <span className="opacity-60">· ⌀ {formatEur(avg)}/Tag</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Models in Trouble */}
        <ModelsInTroubleCard
          platform={platform}
          modelNames={models.map((m) => m.model_name)}
          onSelectModel={setPerfModelName}
        />

        {/* Table */}
        <div className="premium-card rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.05]">
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] gold-text-subtle font-medium uppercase tracking-[0.2em]">Model</th>
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] gold-text-subtle font-medium uppercase tracking-[0.2em]">Follower</th>
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] gold-text-subtle font-medium uppercase tracking-[0.2em]">Umsatz</th>
                <th className="text-left py-3 sm:py-4 px-4 sm:px-8 text-[10px] gold-text-subtle font-medium uppercase tracking-[0.2em] hidden sm:table-cell">Hinzugefügt</th>
                <th className="text-right py-3 sm:py-4 px-4 sm:px-8 text-[10px] gold-text-subtle font-medium uppercase tracking-[0.2em]">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-white/20 font-light text-sm">
                    {models.length === 0 ? "Keine Models" : "Keine Models für diesen Filter"}
                  </td>
                </tr>
              )}
              {filteredModels.map((m) => {
                const rev = modelRevenues[m.model_name];
                const hasRevenue = rev && rev.totalRevenue > 0;

                return (
                  <tr key={m.id} className="row-accent border-b border-white/[0.03] transition-colors duration-300">
                    {editId === m.id ? (
                      <>
                        <td className="py-3 sm:py-4 px-4 sm:px-8 space-y-1.5">
                          <Input value={editName} onChange={(e) => setEditName(capitalizeName(e.target.value))} placeholder="Name" className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 text-sm font-light" />
                          <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="E-Mail" type="email" autoComplete="off" className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 text-xs font-light" />
                          <Input value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Passwort" type="text" autoComplete="off" className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 text-xs font-light" />
                        </td>
                        <td className="py-3 sm:py-4 px-4 sm:px-8 align-top">
                          <Input value={editFollowers} onChange={(e) => setEditFollowers(e.target.value)} type="number" className="bg-white/[0.03] border-white/[0.06] text-foreground h-8 w-20 sm:w-28 text-sm font-light" />
                        </td>
                        <td className="py-3 sm:py-4 px-4 sm:px-8 text-white/20 text-xs font-light align-top">
                          {hasRevenue ? formatEur(rev.totalRevenue) : "–"}
                        </td>
                        <td className="py-3 sm:py-4 px-4 sm:px-8 hidden sm:table-cell text-white/20 text-xs font-light align-top">
                          {new Date(m.created_at).toLocaleDateString("de-DE")}
                        </td>
                        <td className="py-3 sm:py-4 px-4 sm:px-8 text-right space-x-1 align-top">
                          <Button size="sm" variant="ghost" onClick={saveEdit} className="text-primary/60 hover:text-primary hover:bg-primary/5 h-7 w-7 p-0"><Save className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditId(null)} className="text-white/25 hover:text-white/50 h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-4 sm:py-5 px-4 sm:px-8">
                          <button
                            onClick={() => setPerfModelName(m.model_name)}
                            className="text-foreground/85 font-light text-[13px] tracking-wide hover:text-primary transition-colors inline-flex items-center gap-1.5 group"
                            title="Performance ansehen"
                          >
                            {m.model_name}
                            <LineChartIcon className="h-3 w-3 text-white/20 group-hover:text-primary/70 transition-colors" />
                          </button>
                          {m.email && (
                            <button
                              onClick={() => { navigator.clipboard.writeText(m.email!); toast.success("E-Mail kopiert"); }}
                              className="block text-[10px] text-white/35 font-light mt-0.5 hover:text-white/60 transition-colors text-left"
                              title="E-Mail kopieren"
                            >
                              ✉ {m.email}
                            </button>
                          )}
                          {m.password && (
                            <button
                              onClick={() => { navigator.clipboard.writeText(m.password!); toast.success("Passwort kopiert"); }}
                              className="block text-[10px] text-white/30 font-light mt-0.5 hover:text-white/60 transition-colors text-left"
                              title="Passwort kopieren"
                            >
                              🔑 {"•".repeat(Math.min(m.password.length, 10))}
                            </button>
                          )}
                          <span className="block sm:hidden text-[10px] text-white/20 font-light mt-0.5">seit {new Date(m.created_at).toLocaleDateString("de-DE")}</span>
                          <ModelArchetypePanel
                            modelId={m.id}
                            modelName={m.model_name}
                            profileUrl={m.profile_url ?? null}
                            profileImageUrl={m.profile_image_url ?? null}
                            attributes={attributesByModel[m.id] ?? null}
                            onChange={() => { fetchModels(); loadAttributes(models.map((mm) => mm.id)); }}
                          />
                        </td>
                        <td className="py-4 sm:py-5 px-4 sm:px-8 text-foreground/60 font-extralight text-base sm:text-lg tracking-tight align-top">{m.follower_count.toLocaleString()}</td>
                        <td className="py-4 sm:py-5 px-4 sm:px-8 align-top">
                          {hasRevenue ? (
                            <div>
                              <span className="text-base font-extralight gold-text tracking-tight tabular-nums">{formatEur(rev.totalRevenue)}</span>
                              <span className="block text-[10px] text-white/25 font-light mt-0.5 tracking-wide">{rev.days} Einträge</span>
                            </div>
                          ) : (
                            <span className="text-xs text-white/15 font-light italic">Kein Umsatz</span>
                          )}
                        </td>
                        <td className="py-4 sm:py-5 px-4 sm:px-8 text-white/25 font-light text-xs hidden sm:table-cell align-top">{new Date(m.created_at).toLocaleDateString("de-DE")}</td>
                        <td className="py-4 sm:py-5 px-4 sm:px-8 text-right space-x-1 align-top">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(m)} className="text-white/15 hover:text-white/50 hover:bg-white/[0.03] h-7 w-7 p-0"><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(m.id)} className="text-white/15 hover:text-red-400/60 hover:bg-red-400/5 h-7 w-7 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </AnimatePresence>

    <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
      <AlertDialogContent className="bg-[#141414] border-white/5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground/85">Model löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Das Model wird unwiderruflich gelöscht. Bist du sicher?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/10 text-foreground/60">Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete} className="bg-red-500/80 hover:bg-red-500 text-white">Löschen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <ModelPerformanceSlideOver
      open={!!perfModelName}
      onClose={() => setPerfModelName(null)}
      modelName={perfModelName}
      platform={platform}
    />
    </>
  );
}
