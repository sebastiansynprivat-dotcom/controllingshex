import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import ModelPickerModal from "./ModelPickerModal";
import FiltersModal from "./FiltersModal";
import ChatsViewerModal from "./ChatsViewerModal";
import type { LinkedUser } from "@/lib/get-chats-mocks";

type Step = "models" | "filters" | "viewer" | null;

export interface SelectedModel {
  platform: string;
  username: string;
}

export interface SubmittedFilters {
  telegram_id: string;
  platform: string;
  token: string;
  date_range: { start: string; end: string };
  user?: LinkedUser;
}

export default function GetChatsButton({ telegramId = "" }: { telegramId?: string }) {
  const [step, setStep] = useState<Step>(null);
  const [model, setModel] = useState<SelectedModel | null>(null);
  const [filters, setFilters] = useState<SubmittedFilters | null>(null);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setStep("models")}
        className="h-8 px-3 rounded-full border-white/10 bg-white/[0.03] text-[11px] tracking-wide text-white/75 hover:bg-white/[0.06] hover:text-white"
      >
        <MessageSquareText className="h-3.5 w-3.5 mr-1.5 opacity-70" />
        Get-Chats
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
        onSubmit={(payload) => {
          setFilters(payload);
          // TODO: replace with real POST to backend
          console.log("[Get-Chats] submit payload", payload);
          setStep("viewer");
        }}
      />

      <ChatsViewerModal
        open={step === "viewer"}
        onOpenChange={(o) => !o && setStep(null)}
        filters={filters}
      />
    </>
  );
}
