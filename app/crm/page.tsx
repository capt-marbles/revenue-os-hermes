"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOCAL_DEAL_STAGES, STAGE_LABELS } from "@/lib/crm/deal-stages";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface TwentyOpportunity {
  id: string;
  name: string;
  stage: string | null;
  amount?: { amountMicros?: number | null; currencyCode?: string | null } | null;
  mrr?: number | null;
  closeDate?: string | null;
  revenueDate?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  companyId?: string | null;
  studioName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  salesMotion?: string | null;
  notes?: string | null;
}

interface ParsedDeal {
  id: string;
  name: string;
  stage: string;
  value: number | null;
  company: string;
  closeDate: string | null;
  revenueDate: string | null;
  lastActivityDate: string | null;
  createdAt: string | null;
  contactName: string | null;
  contactEmail: string | null;
  salesMotion: string | null;
  notes: string | null;
}

interface Agent {
  id: string;
  name: string;
  slug: string;
}

interface Activity {
  id: string;
  dealId: string;
  content: string;
  type: string;
  createdAt: string;
}

/* ─── Stage config ───────────────────────────────────────────────────────── */

interface StageMeta {
  accent: string;   // solid hex — header bg, value text
  tint: string;     // ~10% opacity — card background
  glow: string;     // ~22% opacity — stage pill bg, drop highlight
}

const STAGE_META: Record<string, StageMeta> = {
  target_account:       { accent: "#a78bfa", tint: "rgba(167,139,250,0.10)", glow: "rgba(167,139,250,0.22)" },
  reachout:             { accent: "#f97316", tint: "rgba(249,115,22,0.10)",  glow: "rgba(249,115,22,0.22)"  },
  connected:            { accent: "#0ea5e9", tint: "rgba(14,165,233,0.10)",  glow: "rgba(14,165,233,0.22)"  },
  technical_evaluation: { accent: "#8b5cf6", tint: "rgba(139,92,246,0.10)",  glow: "rgba(139,92,246,0.22)"  },
  contract_signed:      { accent: "#10b981", tint: "rgba(16,185,129,0.10)",  glow: "rgba(16,185,129,0.22)"  },
  live:                 { accent: "#22c55e", tint: "rgba(34,197,94,0.10)",   glow: "rgba(34,197,94,0.22)"   },
  lost:                 { accent: "#64748b", tint: "rgba(100,116,139,0.08)",  glow: "rgba(100,116,139,0.18)" },
  quote_issued:         { accent: "#f59e0b", tint: "rgba(245,158,11,0.10)",  glow: "rgba(245,158,11,0.22)"  },
  committed:            { accent: "#06b6d4", tint: "rgba(6,182,212,0.10)",   glow: "rgba(6,182,212,0.22)"   },
  // legacy / fallback names
  discovered:           { accent: "#f59e0b", tint: "rgba(245,158,11,0.10)",  glow: "rgba(245,158,11,0.22)"  },
  won:                  { accent: "#10b981", tint: "rgba(16,185,129,0.10)",  glow: "rgba(16,185,129,0.22)"  },
};

const DEFAULT_META: StageMeta = { accent: "#94a3b8", tint: "rgba(148,163,184,0.08)", glow: "rgba(148,163,184,0.18)" };

function getMeta(stage: string): StageMeta {
  return STAGE_META[stage.toLowerCase()] ?? DEFAULT_META;
}

function fmtStage(stage: string): string {
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function parseDeal(r: TwentyOpportunity): ParsedDeal {
  return {
    id: r.id,
    name: r.name || "Untitled",
    stage: r.stage ?? "Unknown",
    value: r.mrr ?? (r.amount?.amountMicros != null ? r.amount.amountMicros / 1_000_000 : null),
    company: r.studioName ?? r.companyId ?? "—",
    closeDate: r.closeDate ?? null,
    revenueDate: r.revenueDate ?? null,
    lastActivityDate: r.updatedAt ?? null,
    createdAt: r.createdAt ?? null,
    contactName: r.contactName ?? null,
    contactEmail: r.contactEmail ?? null,
    salesMotion: r.salesMotion ?? null,
    notes: r.notes ?? null,
  };
}

function fmt(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

function rel(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function colTotal(deals: ParsedDeal[]): number {
  return deals.reduce((s, d) => s + (d.value ?? 0), 0);
}

/* ─── Skeleton ───────────────────────────────────────────────────────────── */

function KanbanSkeleton() {
  return (
    <div className="flex gap-4 p-6 overflow-x-auto">
      {[1, 2, 3, 4].map((col) => (
        <div key={col} className="flex flex-col gap-3 min-w-[300px]">
          <Skeleton className="h-14 rounded-xl" />
          {[1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-36 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── Pipeline summary ───────────────────────────────────────────────────── */

function PipelineSummary({ deals }: { deals: ParsedDeal[] }) {
  const active = deals.filter((d) => d.stage !== "Closed Lost");
  const won    = deals.filter((d) => d.stage === "Closed Won");

  const stats = [
    { label: "Active deals",   value: String(active.length),        accent: "#0ea5e9" },
    { label: "Pipeline value", value: fmt(colTotal(active)),         accent: "#6366f1" },
    { label: "Closed won",     value: fmt(colTotal(won)),            accent: "#10b981" },
    { label: "Win rate",
      value: deals.length > 0
        ? `${Math.round((won.length / deals.length) * 100)}%`
        : "—",
      accent: "#f59e0b",
    },
  ];

  return (
    <div className="flex items-stretch gap-px border-b border-border bg-border">
      {stats.map(({ label, value, accent }) => (
        <div key={label} className="flex-1 flex flex-col gap-0.5 bg-background px-5 py-3.5" style={{ borderTop: `3px solid ${accent}` }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="text-xl font-bold tabular-nums" style={{ color: accent }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Deal card body (shared between card + overlay) ────────────────────── */

function DealCardBody({ deal }: { deal: ParsedDeal }) {
  const meta = getMeta(deal.stage);
  return (
    <div
      className="rounded-xl border border-border/60 overflow-hidden select-none"
      style={{ backgroundColor: meta.tint }}
    >
      {/* Colored top stripe */}
      <div className="h-1.5 w-full" style={{ backgroundColor: meta.accent }} />

      <div className="p-4 space-y-3">
        {/* name + value */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-semibold leading-snug">{deal.name}</p>
          {deal.value != null && (
            <p
              className="text-lg font-bold tabular-nums shrink-0 leading-tight"
              style={{ color: meta.accent }}
            >
              {fmt(deal.value)}
            </p>
          )}
        </div>

        {/* company */}
        {deal.company !== "—" && (
          <p className="text-sm font-medium text-muted-foreground truncate">
            {deal.company}
          </p>
        )}

        {/* footer: stage pill + dates */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: meta.glow, color: meta.accent }}
          >
            {fmtStage(deal.stage)}
          </span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
            {deal.closeDate && (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5" />
                </svg>
                {rel(deal.closeDate)}
              </span>
            )}
            {deal.lastActivityDate && (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                {rel(deal.lastActivityDate)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Draggable deal card ────────────────────────────────────────────────── */

function DealCard({
  deal,
  onOpen,
  isBeingDragged,
}: {
  deal: ParsedDeal;
  onOpen: (deal: ParsedDeal) => void;
  isBeingDragged: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  if (isBeingDragged) {
    return (
      <div
        ref={setNodeRef}
        className="h-32 rounded-xl border-2 border-dashed border-border/50 bg-muted/20"
      />
    );
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        onClick={() => onOpen(deal)}
        className="cursor-pointer active:cursor-grabbing"
      >
        <DealCardBody deal={deal} />
      </div>
    </div>
  );
}

/* ─── Deal detail panel ──────────────────────────────────────────────────── */

const ACTIVITY_TYPES = ["note", "email", "call", "meeting"] as const;

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-border space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground shrink-0 w-24">{label}</span>
      <span className="text-xs font-medium text-right leading-snug">{value}</span>
    </div>
  );
}

const SALES_MOTIONS = ["inbound", "outbound", "partner", "referral", "expansion"] as const;

type EditForm = {
  name: string; studioName: string; contactName: string; contactEmail: string;
  mrr: string; salesMotion: string; stage: string;
  closeDate: string; revenueDate: string; notes: string;
};

function dealToForm(d: ParsedDeal): EditForm {
  return {
    name: d.name,
    studioName: d.company !== "—" ? d.company : "",
    contactName: d.contactName ?? "",
    contactEmail: d.contactEmail ?? "",
    mrr: d.value != null ? String(d.value) : "",
    salesMotion: d.salesMotion ?? "outbound",
    stage: d.stage,
    closeDate: d.closeDate ?? "",
    revenueDate: d.revenueDate ?? "",
    notes: d.notes ?? "",
  };
}

function DealPanel({
  deal,
  agents,
  onClose,
  onUpdate,
  onDelete,
}: {
  deal: ParsedDeal | null;
  agents: Agent[];
  onClose: () => void;
  onUpdate: (updated: ParsedDeal) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [instructions, setInstructions] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityText, setActivityText] = useState("");
  const [activityType, setActivityType] = useState<string>("note");
  const [activityLoading, setActivityLoading] = useState(false);
  const [submittingActivity, setSubmittingActivity] = useState(false);

  useEffect(() => {
    setEditing(false);
    setForm(null);
    setSaveError(null);
    setMovingTo(null);
    setSelectedAgent(null);
    setInstructions("");
    setRunResult(null);
    setActivities([]);
    setActivityText("");
    if (!deal) return;
    setActivityLoading(true);
    fetch(`/api/deals/${deal.id}/activities`)
      .then((r) => r.ok ? r.json() : { activities: [] })
      .then((d) => setActivities(d.activities ?? []))
      .finally(() => setActivityLoading(false));
  }, [deal?.id]);

  const startEdit = useCallback(() => {
    if (!deal) return;
    setForm(dealToForm(deal));
    setSaveError(null);
    setEditing(true);
  }, [deal]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setForm(null);
    setSaveError(null);
  }, []);

  const moveToStage = useCallback(async (stage: string) => {
    if (!deal) return;
    setMovingTo(stage);
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (res.ok) {
      const { deal: saved } = await res.json();
      onUpdate({ ...deal, stage: saved.stage, lastActivityDate: saved.updatedAt ?? null });
    }
    setMovingTo(null);
  }, [deal, onUpdate]);

  const confirmDelete = useCallback(async () => {
    if (!deal) return;
    setDeleting(true);
    const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) onDelete(deal.id);
  }, [deal, onDelete]);

  const saveEdit = useCallback(async () => {
    if (!form || !deal) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: form.name.trim(),
        studioName: form.studioName.trim() || undefined,
        contactName: form.contactName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        mrr: form.mrr !== "" ? Number(form.mrr) : null,
        salesMotion: form.salesMotion || undefined,
        stage: form.stage,
        closeDate: form.closeDate || null,
        revenueDate: form.revenueDate || null,
        notes: form.notes.trim() || undefined,
      };
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? "Failed to save");
        return;
      }
      const { deal: saved } = await res.json();
      const updated: ParsedDeal = {
        ...deal,
        name: saved.name,
        stage: saved.stage,
        value: saved.mrr ?? null,
        company: saved.studioName ?? "—",
        contactName: saved.contactName ?? null,
        contactEmail: saved.contactEmail ?? null,
        salesMotion: saved.salesMotion ?? null,
        closeDate: saved.closeDate ?? null,
        revenueDate: saved.revenueDate ?? null,
        notes: saved.notes ?? null,
        lastActivityDate: saved.updatedAt ?? null,
      };
      onUpdate(updated);
      setEditing(false);
      setForm(null);
    } finally {
      setSaving(false);
    }
  }, [form, deal, onUpdate]);

  const submitActivity = useCallback(async () => {
    if (!activityText.trim() || !deal) return;
    setSubmittingActivity(true);
    const res = await fetch(`/api/deals/${deal.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: activityText, type: activityType }),
    });
    if (res.ok) {
      const data = await res.json();
      setActivities((prev) => [data.activity, ...prev]);
      setActivityText("");
    }
    setSubmittingActivity(false);
  }, [deal, activityText, activityType]);

  const confirmRun = useCallback(async () => {
    if (!selectedAgent || !deal) return;
    setRunning(true);
    setRunResult(null);
    const ctx = [
      `Deal: ${deal.name}`,
      deal.company !== "—" ? `Company: ${deal.company}` : null,
      `Stage: ${fmtStage(deal.stage)}`,
      deal.value != null ? `MRR: $${deal.value.toLocaleString()}/mo` : null,
      deal.contactName ? `Contact: ${deal.contactName}` : null,
    ].filter(Boolean).join(". ");
    const input = instructions ? `${ctx}. ${instructions}` : ctx;
    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      setRunResult(res.ok ? `Queued — run ${data.runId}` : `Error: ${data.error ?? res.statusText}`);
    } catch (err) {
      setRunResult(`Error: ${err instanceof Error ? err.message : "Request failed"}`);
    } finally {
      setRunning(false);
    }
  }, [selectedAgent, deal, instructions]);

  const meta = deal ? getMeta(deal.stage) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/20 transition-opacity duration-200",
          deal ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-[440px] bg-background border-l border-border shadow-2xl",
          "flex flex-col transition-transform duration-200 ease-out",
          deal ? "translate-x-0" : "translate-x-full",
        )}
      >
        {deal && meta && (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-border shrink-0" style={{ borderTop: `4px solid ${meta.accent}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: meta.glow, color: meta.accent }}>
                      {fmtStage(deal.stage)}
                    </span>
                    {deal.value != null && (
                      <span className="text-sm font-bold tabular-nums" style={{ color: meta.accent }}>
                        ${deal.value.toLocaleString()}/mo
                      </span>
                    )}
                  </div>
                  <p className="text-base font-semibold leading-snug">{deal.name}</p>
                  {deal.company !== "—" && <p className="text-xs text-muted-foreground mt-0.5">{deal.company}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!editing && (
                    <>
                      <button onClick={startEdit} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground" title="Edit deal">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                        </svg>
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Delete deal">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete deal?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete <strong>{deal?.name}</strong> and all its activity history. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={confirmDelete}
                              disabled={deleting}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                  <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {editing && form ? (
                /* ── Edit mode ── */
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Edit deal</p>

                  {(["name", "studioName", "contactName", "contactEmail"] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs text-muted-foreground block mb-1">
                        {{ name: "Deal name", studioName: "Studio", contactName: "Contact name", contactEmail: "Contact email" }[field]}
                      </label>
                      <input
                        type={field === "contactEmail" ? "email" : "text"}
                        value={form[field]}
                        onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
                        style={{ ["--tw-ring-color" as string]: meta.accent }}
                      />
                    </div>
                  ))}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Stage</label>
                      <select
                        value={form.stage}
                        onChange={(e) => setForm({ ...form, stage: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
                      >
                        {LOCAL_DEAL_STAGES.map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Sales motion</label>
                      <select
                        value={form.salesMotion}
                        onChange={(e) => setForm({ ...form, salesMotion: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
                      >
                        {SALES_MOTIONS.map((m) => (
                          <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">MRR (USD)</label>
                      <input
                        type="number" min="0"
                        value={form.mrr}
                        onChange={(e) => setForm({ ...form, mrr: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
                        style={{ ["--tw-ring-color" as string]: meta.accent }}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Close date</label>
                      <input
                        type="date"
                        value={form.closeDate}
                        onChange={(e) => setForm({ ...form, closeDate: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
                        style={{ ["--tw-ring-color" as string]: meta.accent }}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted-foreground block mb-1">Revenue date</label>
                      <input
                        type="date"
                        value={form.revenueDate}
                        onChange={(e) => setForm({ ...form, revenueDate: e.target.value })}
                        className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
                        style={{ ["--tw-ring-color" as string]: meta.accent }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Quick move</label>
                    <div className="flex gap-2">
                      {[
                        { stage: "reachout", label: "Target Accounts", color: "#f97316" },
                        { stage: "connected", label: "Nurture", color: "#0ea5e9" },
                      ].filter((m) => m.stage !== deal.stage).map((m) => (
                        <button
                          key={m.stage}
                          type="button"
                          onClick={() => moveToStage(m.stage)}
                          disabled={movingTo !== null}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {movingTo === m.stage
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                          }
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={4}
                      className="text-sm resize-none"
                    />
                  </div>

                  {saveError && (
                    <p className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded-lg">{saveError}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={cancelEdit} className="flex-1" disabled={saving}>Cancel</Button>
                    <Button size="sm" onClick={saveEdit} disabled={saving} className="flex-1" style={{ backgroundColor: meta.accent, borderColor: meta.accent }}>
                      {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── View mode ── */
                <>
                  <PanelSection title="Deal details">
                    <FactRow label="Studio" value={deal.company !== "—" ? deal.company : null} />
                    <FactRow label="Contact" value={deal.contactName ? (
                      <span className="flex flex-col items-end gap-0.5">
                        <span>{deal.contactName}</span>
                        {deal.contactEmail && (
                          <a href={`mailto:${deal.contactEmail}`} className="text-muted-foreground hover:underline">{deal.contactEmail}</a>
                        )}
                      </span>
                    ) : null} />
                    <FactRow label="MRR" value={deal.value != null ? `$${deal.value.toLocaleString()}/mo` : null} />
                    <FactRow label="Sales motion" value={deal.salesMotion ? (
                      <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted">{deal.salesMotion}</span>
                    ) : null} />
                    <FactRow label="Close date" value={deal.closeDate ? new Date(deal.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null} />
                    <FactRow label="Revenue date" value={deal.revenueDate ? new Date(deal.revenueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null} />
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground shrink-0 w-24">Move to</span>
                      <div className="flex items-center gap-1.5">
                        {movingTo && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        <select
                          value=""
                          disabled={movingTo !== null}
                          onChange={(e) => { if (e.target.value) moveToStage(e.target.value); }}
                          className="text-xs border border-border rounded-md px-2 py-1 bg-background text-muted-foreground disabled:opacity-50 cursor-pointer"
                        >
                          <option value="" disabled>Select stage…</option>
                          {[
                            { stage: "reachout", label: "Target Accounts" },
                            { stage: "connected", label: "Nurture" },
                          ].filter((m) => m.stage !== deal.stage).map((m) => (
                            <option key={m.stage} value={m.stage}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <FactRow label="Last active" value={deal.lastActivityDate ? rel(deal.lastActivityDate) : null} />
                  </PanelSection>

                  {deal.notes && (
                    <PanelSection title="Notes">
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{deal.notes}</p>
                    </PanelSection>
                  )}
                </>
              )}

              {/* Activity log — always visible */}
              {!editing && (
                <PanelSection title="Activity">
                  <div className="flex gap-2">
                    <select
                      value={activityType}
                      onChange={(e) => setActivityType(e.target.value)}
                      className="text-xs border border-border rounded-md px-2 py-1.5 bg-background shrink-0 text-muted-foreground"
                    >
                      {ACTIVITY_TYPES.map((t) => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                    <input
                      value={activityText}
                      onChange={(e) => setActivityText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitActivity(); } }}
                      placeholder="Log an activity…"
                      className="flex-1 text-xs border border-border rounded-md px-3 py-1.5 bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1"
                    />
                    <button
                      onClick={submitActivity}
                      disabled={submittingActivity || !activityText.trim()}
                      className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-white disabled:opacity-40 transition-opacity"
                      style={{ backgroundColor: meta.accent }}
                    >
                      {submittingActivity
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      }
                    </button>
                  </div>
                  {activityLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50 text-center py-3">No activity logged yet</p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {activities.map((a) => (
                        <div key={a.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize" style={{ backgroundColor: meta.glow, color: meta.accent }}>
                              {a.type.replace("_", " ")}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{rel(a.createdAt)}</span>
                          </div>
                          <p className="text-xs leading-snug">{a.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelSection>
              )}

              {/* Agent runner — always visible */}
              {!editing && (
                <div className="px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Run an agent</p>
                  <div className="flex flex-wrap gap-2">
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => setSelectedAgent((a) => a?.id === agent.id ? null : agent)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150",
                          selectedAgent?.id === agent.id
                            ? "border-transparent text-white"
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground bg-background",
                        )}
                        style={selectedAgent?.id === agent.id ? { backgroundColor: meta.accent } : undefined}
                      >
                        {agent.name}
                      </button>
                    ))}
                  </div>
                  {selectedAgent && (
                    <div className="mt-3 space-y-3">
                      <Textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder={`Tell ${selectedAgent.name} what to focus on…`}
                        rows={2}
                        className="text-xs resize-none"
                      />
                      <Button className="w-full" onClick={confirmRun} disabled={running} style={!running ? { backgroundColor: meta.accent, borderColor: meta.accent } : undefined}>
                        {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        {running ? "Running…" : `Run ${selectedAgent.name}`}
                      </Button>
                      {runResult && (
                        <p className={cn("text-xs px-3 py-2 rounded-lg", runResult.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600")}>
                          {runResult}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ─── Droppable + sortable stage column ─────────────────────────────────── */

function StageColumn({
  stage,
  deals,
  onOpen,
  activeId,
  activeDragType,
}: {
  stage: string;
  deals: ParsedDeal[];
  onOpen: (deal: ParsedDeal) => void;
  activeId: string | null;
  activeDragType: "card" | "column" | null;
}) {
  const meta = getMeta(stage);

  // Sortable — for column reordering; id prefixed so it doesn't clash with card ids
  const {
    attributes,
    listeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging: isColDragging,
  } = useSortable({ id: `col-${stage}` });

  // Droppable — for card drops; only highlight when a card is being dragged
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: stage });
  const showDropHighlight = isOver && activeDragType === "card";

  const total = colTotal(deals);

  return (
    <div
      ref={setSortRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isColDragging ? 0.4 : 1,
        zIndex: isColDragging ? 50 : undefined,
      }}
      className="flex flex-col min-w-[300px] max-w-[340px] shrink-0"
    >
      {/* Column header — solid accent */}
      <div
        className="rounded-xl mb-3 px-4 py-3 flex items-center justify-between gap-3 transition-all duration-200"
        style={{ backgroundColor: meta.accent }}
      >
        <div className="flex items-center gap-2.5">
          {/* Grip handle */}
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none p-0.5 -ml-1 rounded text-white/50 hover:text-white transition-colors"
            aria-label={`Reorder ${fmtStage(stage)} column`}
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16">
              <circle cx="5" cy="4" r="1.2" /><circle cx="5" cy="8" r="1.2" /><circle cx="5" cy="12" r="1.2" />
              <circle cx="11" cy="4" r="1.2" /><circle cx="11" cy="8" r="1.2" /><circle cx="11" cy="12" r="1.2" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white">{fmtStage(stage)}</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/20 text-white">
            {deals.length}
          </span>
        </div>
        {total > 0 && (
          <span className="text-sm font-bold tabular-nums text-white/90">
            {fmt(total)}
          </span>
        )}
      </div>

      {/* Drop zone for cards */}
      <div
        ref={setDropRef}
        className={cn(
          "flex-1 space-y-2.5 rounded-xl transition-all duration-200 min-h-[120px]",
          showDropHighlight && "bg-muted/30",
        )}
        style={showDropHighlight ? { outline: `2px dashed ${meta.accent}`, outlineOffset: "4px", backgroundColor: meta.glow } : undefined}
      >
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            onOpen={onOpen}
            isBeingDragged={activeId === deal.id}
          />
        ))}
        {deals.length === 0 && !showDropHighlight && (
          <div className="rounded-xl border border-dashed border-border/40 py-8 text-center">
            <p className="text-xs text-muted-foreground/40">Drop deals here</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Add deal dialog ────────────────────────────────────────────────────── */

type AddForm = {
  name: string; studioName: string; contactName: string; contactEmail: string;
  mrr: string; salesMotion: string; stage: string;
  closeDate: string; revenueDate: string; notes: string;
};

const EMPTY_FORM: AddForm = {
  name: "", studioName: "", contactName: "", contactEmail: "",
  mrr: "", salesMotion: "outbound", stage: "target_account",
  closeDate: "", revenueDate: "", notes: "",
};

function AddDealDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (deal: ParsedDeal) => void;
}) {
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }, [onClose]);

  const submit = useCallback(async () => {
    if (!form.name.trim()) { setError("Deal name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          stage: form.stage,
          salesMotion: form.salesMotion,
          studioName: form.studioName.trim() || undefined,
          contactName: form.contactName.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          mrr: form.mrr !== "" ? Number(form.mrr) : undefined,
          closeDate: form.closeDate || undefined,
          revenueDate: form.revenueDate || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to create deal");
        return;
      }
      const { deal: saved } = await res.json();
      onCreated({
        id: saved.id,
        name: saved.name,
        stage: saved.stage,
        value: saved.mrr ?? null,
        company: saved.studioName ?? "—",
        closeDate: saved.closeDate ?? null,
        revenueDate: saved.revenueDate ?? null,
        lastActivityDate: saved.updatedAt ?? null,
        createdAt: saved.createdAt ?? null,
        contactName: saved.contactName ?? null,
        contactEmail: saved.contactEmail ?? null,
        salesMotion: saved.salesMotion ?? null,
        notes: saved.notes ?? null,
      });
      handleClose();
    } finally {
      setSaving(false);
    }
  }, [form, onCreated, handleClose]);

  const accent = getMeta(form.stage).accent;
  const f = (key: keyof AddForm, label: string, type = "text") => (
    <div key={key}>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add deal</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {f("name", "Deal name *")}
          {f("studioName", "Studio / Company")}
          {f("contactName", "Contact name")}
          {f("contactEmail", "Contact email", "email")}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Stage</label>
              <select
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
              >
                {LOCAL_DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sales motion</label>
              <select
                value={form.salesMotion}
                onChange={(e) => setForm({ ...form, salesMotion: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background"
              >
                {SALES_MOTIONS.map((m) => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">MRR (USD)</label>
              <input
                type="number" min="0"
                value={form.mrr}
                onChange={(e) => setForm({ ...form, mrr: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Close date</label>
              <input
                type="date"
                value={form.closeDate}
                onChange={(e) => setForm({ ...form, closeDate: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Revenue date</label>
              <input
                type="date"
                value={form.revenueDate}
                onChange={(e) => setForm({ ...form, revenueDate: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded-lg">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={handleClose} className="flex-1" disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={saving || !form.name.trim()}
              className="flex-1"
              style={{ backgroundColor: accent, borderColor: accent }}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {saving ? "Adding…" : "Add deal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function CrmPage() {
  const [deals, setDeals] = useState<ParsedDeal[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<"card" | "column" | null>(null);
  const [stageOrder, setStageOrder] = useState<string[]>([]);

  const [panelDeal, setPanelDeal] = useState<ParsedDeal | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [dealsRes, agentsRes] = await Promise.all([
          fetch("/api/crm/deals"),
          fetch("/api/agents?source=seed"),
        ]);
        if (dealsRes.status === 503) { setNotConnected(true); setLoading(false); return; }
        if (!dealsRes.ok) {
          const body = await dealsRes.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to fetch deals (${dealsRes.status})`);
        }
        const dd = await dealsRes.json();
        const records: TwentyOpportunity[] = dd.data?.opportunities ?? dd.data ?? [];
        setDeals(records.map(parseDeal));
        if (agentsRes.ok) setAgents(await agentsRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load CRM data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const stages = useMemo(() => {
    const g: Record<string, ParsedDeal[]> = {};
    for (const d of deals) {
      if (!g[d.stage]) g[d.stage] = [];
      g[d.stage].push(d);
    }
    return g;
  }, [deals]);

  // Build stageOrder from known stages + any in the data, preserving saved positions
  useEffect(() => {
    if (loading) return;
    const known = [...LOCAL_DEAL_STAGES] as string[];
    const present = Object.keys(stages);
    // Union: known stages first (in canonical order), then any unknown ones from data
    const all = [...known];
    for (const s of present) if (!all.includes(s)) all.push(s);
    // If we have a saved order, keep it but append any new stages not yet in it
    setStageOrder((prev) => {
      const merged = prev.length > 0 ? [...prev] : all;
      for (const s of all) if (!merged.includes(s)) merged.push(s);
      return merged;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Persist order on every change
  useEffect(() => {
    if (stageOrder.length === 0) return;
    try { localStorage.setItem("crm-stage-order", JSON.stringify(stageOrder)); } catch { /* quota */ }
  }, [stageOrder]);

  const activeDeal = useMemo(
    () => (activeDragType === "card" && activeId ? deals.find((d) => d.id === activeId) ?? null : null),
    [activeId, activeDragType, deals],
  );
  const activeStage = useMemo(
    () => (activeDragType === "column" && activeId ? activeId.replace("col-", "") : null),
    [activeId, activeDragType],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    setActiveDragType(id.startsWith("col-") ? "column" : "card");
    setPanelDeal(null); // close panel when drag starts
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const id = String(e.active.id);
      const overId = e.over?.id as string | undefined;
      setActiveId(null);
      setActiveDragType(null);

      if (!overId) return;

      if (id.startsWith("col-")) {
        // Column reorder
        if (!overId.startsWith("col-")) return;
        const fromStage = id.replace("col-", "");
        const toStage = overId.replace("col-", "");
        if (fromStage === toStage) return;
        setStageOrder((prev) => {
          const from = prev.indexOf(fromStage);
          const to = prev.indexOf(toStage);
          return from === -1 || to === -1 ? prev : arrayMove(prev, from, to);
        });
      } else {
        // Card move between columns
        // overId may be "col-<stage>" (sortable header) or plain "<stage>" (droppable zone)
        const targetStage = overId?.startsWith("col-") ? overId.slice(4) : overId;
        const deal = deals.find((d) => d.id === id);
        if (!deal || !targetStage || deal.stage === targetStage) return;
        setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stage: targetStage } : d)));
        fetch(`/api/crm/deals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: targetStage }),
        }).catch(() => {
          setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stage: deal.stage } : d)));
        });
      }
    },
    [deals],
  );

  const handleOpenDeal = useCallback((deal: ParsedDeal) => {
    setPanelDeal(deal);
  }, []);

  const handleDealUpdate = useCallback((updated: ParsedDeal) => {
    setDeals((prev) => prev.map((d) => d.id === updated.id ? updated : d));
    setPanelDeal(updated);
  }, []);

  const handleDealDelete = useCallback((id: string) => {
    setDeals((prev) => prev.filter((d) => d.id !== id));
    setPanelDeal(null);
  }, []);

  const handleDealCreated = useCallback((deal: ParsedDeal) => {
    setDeals((prev) => [deal, ...prev]);
  }, []);

  /* ── not connected ── */
  if (notConnected) {
    return (
      <PageShell title="CRM" description="Deal pipeline">
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center px-6">
          <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <div>
            <p className="text-sm font-medium">Connect Twenty to view your deal pipeline</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your <code className="bg-muted px-1 rounded text-[11px]">TWENTY_API_KEY</code> environment variable, or{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">configure it in Settings</Link>.
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="CRM"
      description="Deal pipeline"
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add deal
        </Button>
      }
    >
      <AddDealDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={handleDealCreated} />
      {loading && <KanbanSkeleton />}
      {error && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {!loading && !error && deals.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="text-sm font-medium text-muted-foreground">No deals found</p>
          <p className="text-xs text-muted-foreground/60">Create opportunities in Twenty CRM to see them here</p>
        </div>
      )}

      {!loading && !error && deals.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col">
          <PipelineSummary deals={deals} />
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext
              items={stageOrder.map((s) => `col-${s}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex-1 overflow-x-auto overflow-y-auto" style={{ minHeight: 0 }}>
                <div className="flex gap-5 px-6 py-6 w-max min-w-full items-start">
                  {stageOrder.map((stage) => (
                    <StageColumn
                      key={stage}
                      stage={stage}
                      deals={stages[stage] ?? []}
                      onOpen={handleOpenDeal}
                      activeId={activeId}
                      activeDragType={activeDragType}
                    />
                  ))}
                </div>
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
              {activeDeal && (
                <div className="rotate-1 scale-[1.04] shadow-2xl opacity-95 pointer-events-none">
                  <DealCardBody deal={activeDeal} />
                </div>
              )}
              {activeStage && (
                <div
                  className="rounded-xl px-4 py-3 flex items-center gap-2.5 shadow-2xl opacity-90 pointer-events-none min-w-[200px]"
                  style={{ backgroundColor: getMeta(activeStage).accent }}
                >
                  <span className="text-sm font-semibold text-white">{fmtStage(activeStage)}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      <DealPanel deal={panelDeal} agents={agents} onClose={() => setPanelDeal(null)} onUpdate={handleDealUpdate} onDelete={handleDealDelete} />
    </PageShell>
  );
}
