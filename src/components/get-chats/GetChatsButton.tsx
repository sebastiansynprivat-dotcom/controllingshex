import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ModelPickerModal from "./ModelPickerModal";
import FiltersModal from "./FiltersModal";
import ChatsViewerModal from "./ChatsViewerModal";
import type { LinkedUser } from "@/lib/get-chats-mocks";
import { requestChats } from "@/lib/get-chats-api";

type Step = "models" | "filters" | "viewer" | null;

export interface SelectedModel {
  platform: string;
  username: string;
  token: string;
}

export interface SubmittedFilters {
  telegram_id: string;
  platform: string;
  token: string;
  model_username: string;
  date_range: { start: string; end: string };
  user?: LinkedUser;
}

export default function GetChatsButton({ telegramId = "", compact = false }: { telegramId?: string; compact?: boolean }) {
  const [step, setStep] = useState<Step>(null);
  const [model, setModel] = useState<SelectedModel | null>(null);
  const [filters, setFilters] = useState<SubmittedFilters | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRequest = async (payload: SubmittedFilters) => {
    setError(null);
    setRequestId(null);
    try {
      const { request_id } = await requestChats(payload);
      setRequestId(request_id);
    } catch (e) {
      setError((e as Error).message || "Konnte Chats nicht anfordern");
    }
  };

  const handleRefresh = async () => {
    if (!filters) return;
    await startRequest(filters);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setStep("models")}
        title="Get-Chats"
        className={cn(
          "h-11 rounded-xl border-primary/40 bg-primary/15 text-sm font-semibold tracking-wide text-primary hover:bg-primary/25 hover:text-primary",
          compact ? "shrink-0 px-3 sm:px-4" : "w-full",
        )}
      >
        <MessageSquareText className="h-4 w-4" />
        <span className={compact ? "hidden sm:inline" : undefined}>Get-Chats</span>
      </Button>

      <ModelPickerModal
        open={step === "models"}
        onOpenChange={(o) => !o && setStep(null)}
        telegramId={telegramId}
        onSelect={(m) => {
          setModel(m);
          setStep("filters");
        }}
      />

      <FiltersModal
        open={step === "filters"}
        onOpenChange={(o) => !o && setStep(null)}
        model={model}
        telegramId={telegramId}
        onBack={() => setStep("models")}
        onSubmit={async (payload) => {
          setFilters(payload);
          setStep("viewer");
          await startRequest(payload);
        }}
      />

      <ChatsViewerModal
        open={step === "viewer"}
        onOpenChange={(o) => !o && setStep(null)}
        filters={filters}
        requestId={requestId}
        error={error}
        onRefresh={handleRefresh}
      />
    </>
  );
}
