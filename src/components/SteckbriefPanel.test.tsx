import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SteckbriefPanel from "@/components/SteckbriefPanel";
import type { ShexModelEntry, SteckbriefIdentity } from "@/lib/steckbrief-links";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const MODEL_A = "00000000-0000-4000-8000-00000000000a";
const MODEL_B = "00000000-0000-4000-8000-00000000000b";
const models: ShexModelEntry[] = [
  { model_id: MODEL_A, name: "Fabelstern", username: null, model_active: true, profile_status: "approved" },
  { model_id: MODEL_B, name: "Nebelbogen", username: "nebel", model_active: true, profile_status: "not_approved" },
];
const modelsById = new Map(models.map((model) => [model.model_id, model]));

function identity(overrides: Partial<SteckbriefIdentity> = {}): SteckbriefIdentity {
  return {
    platform: "4Based",
    email: "fabel@example.com",
    status: "approved",
    status_reason: "approved",
    external_model_id: MODEL_A,
    assignment_source: "shex_account",
    assignment_updated_at: null,
    confirmed_at: "2026-09-20T10:15:00.000Z",
    override: null,
    shex_model_ids: [MODEL_A],
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof SteckbriefPanel>[0]> = {}) {
  return render(
    <SteckbriefPanel
      platform="4Based"
      email="Fabel@Example.com"
      identity={identity()}
      models={models}
      modelsById={modelsById}
      onChanged={() => {}}
      {...props}
    />,
  );
}

describe("SteckbriefPanel", () => {
  it("shows an approved Steckbrief with model name, date and source", () => {
    renderPanel();
    expect(screen.getByText("Steckbrief freigegeben")).toBeInTheDocument();
    expect(screen.getByText("Fabelstern · 20.09.2026")).toBeInTheDocument();
    expect(screen.getByText("über SheX-Konto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Steckbrief-Zuordnung ändern" })).toBeInTheDocument();
  });

  it("shows only a muted chip and no actions for rows without login mail", () => {
    renderPanel({ email: "  ", identity: undefined });
    expect(screen.getByText("Keine Login-Mail")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("treats an unknown identity as 'Kein Steckbrief zugeordnet'", () => {
    renderPanel({ identity: undefined });
    expect(screen.getByText("Kein Steckbrief zugeordnet")).toBeInTheDocument();
  });

  it("warns when a Controlling assignment differs from SheX", () => {
    renderPanel({
      identity: identity({
        external_model_id: MODEL_B,
        assignment_source: "controlling",
        status: "not_approved",
        status_reason: "awaiting_approval",
        confirmed_at: null,
        override: { mode: "assign", external_model_id: MODEL_B, external_model_name: "Nebelbogen", updated_at: null },
        shex_model_ids: [MODEL_A],
      }),
    });
    expect(screen.getByText("Wartet auf Freigabe")).toBeInTheDocument();
    expect(screen.getByText("im Controlling zugeordnet")).toBeInTheDocument();
    expect(screen.getByText("SheX ordnet dieses Konto Fabelstern zu")).toBeInTheDocument();
  });
});
