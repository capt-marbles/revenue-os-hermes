"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCron } from "@/lib/autopilots/cron";
import {
  Play,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface Autopilot {
  id: string;
  name: string;
  description: string | null;
  agentSlug: string;
  prompt: string;
  schedule: string;
  mode: string;
  harness: string;
  enabled: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
}

const AGENT_SLUGS = [
  "scout",
  "outreach",
  "steward",
  "marketing",
  "sales-engineering",
  "chief-of-staff",
  "leo",
];

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="size-3.5 text-success" />,
  failed: <XCircle className="size-3.5 text-destructive" />,
  running: <Loader2 className="size-3.5 animate-spin text-blue-500" />,
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

export default function AutomationsPage() {
  const [autopilots, setAutopilots] = useState<Autopilot[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    agentSlug: "scout",
    prompt: "",
    schedule: "0 6 * * *",
    description: "",
    harness: "hermes",
  });

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilots");
      if (!res.ok) throw new Error("Failed");
      setAutopilots(await res.json());
    } catch {
      toast.error("Failed to load autopilots");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const toggleEnabled = async (ap: Autopilot) => {
    const res = await fetch(`/api/autopilots/${ap.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: ap.enabled === 0 }),
    });
    if (res.ok) setAutopilots((prev) => prev.map((p) => p.id === ap.id ? { ...p, enabled: ap.enabled === 0 ? 1 : 0 } : p));
  };

  const trigger = async (ap: Autopilot) => {
    setTriggering(ap.id);
    toast.info(`Triggering ${ap.name}…`);
    const res = await fetch(`/api/autopilots/${ap.id}/trigger`, { method: "POST" });
    setTriggering(null);
    if (res.ok) {
      toast.success(`${ap.name} triggered`);
      fetch_();
    } else {
      toast.error("Trigger failed");
    }
  };

  const delete_ = async (ap: Autopilot) => {
    if (!confirm(`Delete "${ap.name}"?`)) return;
    await fetch(`/api/autopilots/${ap.id}`, { method: "DELETE" });
    setAutopilots((prev) => prev.filter((p) => p.id !== ap.id));
  };

  const create = async () => {
    if (!form.name || !form.prompt) return toast.error("Name and prompt are required");
    const res = await fetch("/api/autopilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      toast.success("Autopilot created");
      setShowCreate(false);
      setForm({ name: "", agentSlug: "scout", prompt: "", schedule: "0 6 * * *", description: "", harness: "hermes" });
      fetch_();
    } else {
      toast.error("Failed to create");
    }
  };

  return (
    <PageShell
      title="Automations"
      description="Scheduled agent runs — the daily flywheel"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {autopilots.filter((a) => a.enabled).length} active · {autopilots.length} total
          </p>
          <Button size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5 mr-1.5" />
            New Autopilot
          </Button>
        </div>

        {showCreate && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">New Autopilot</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <select
                value={form.agentSlug}
                onChange={(e) => setForm((f) => ({ ...f, agentSlug: e.target.value }))}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {AGENT_SLUGS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={form.harness}
                onChange={(e) => setForm((f) => ({ ...f, harness: e.target.value }))}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="hermes">hermes</option>
                <option value="claude-code">claude-code</option>
              </select>
            </div>
            <textarea
              placeholder="Prompt — what should the agent do?"
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-ring/20"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cron schedule</label>
                <Input placeholder="0 6 * * *" value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">{formatCron(form.schedule)}</p>
              </div>
              <Input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={create}>Create</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : autopilots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Zap className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No autopilots yet</p>
            <p className="text-sm text-muted-foreground">Create one to start the daily flywheel.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {autopilots.map((ap) => (
              <div
                key={ap.id}
                className={cn(
                  "flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-opacity",
                  ap.enabled === 0 && "opacity-50"
                )}
              >
                {/* Toggle */}
                <button
                  onClick={() => toggleEnabled(ap)}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    ap.enabled ? "bg-primary" : "bg-muted"
                  )}
                  title={ap.enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                      ap.enabled ? "left-[1.125rem]" : "left-0.5"
                    )}
                  />
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{ap.name}</p>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {ap.agentSlug}
                    </span>
                    {ap.harness === "claude-code" && (
                      <span className="shrink-0 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 text-[11px] font-medium">
                        cc
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatCron(ap.schedule)}
                    </span>
                    {ap.lastRunStatus && (
                      <span className="flex items-center gap-1">
                        {STATUS_ICON[ap.lastRunStatus]}
                        {ap.lastRunAt ? timeAgo(ap.lastRunAt) : "never"}
                      </span>
                    )}
                    {ap.nextRunAt && ap.enabled === 1 && (
                      <span className="text-muted-foreground/70">
                        next {timeUntil(ap.nextRunAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Run now"
                    disabled={triggering === ap.id}
                    onClick={() => trigger(ap)}
                  >
                    {triggering === ap.id
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <Play className="size-3.5" />
                    }
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    title="Delete"
                    onClick={() => delete_(ap)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
