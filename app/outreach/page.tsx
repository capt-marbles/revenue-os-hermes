"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import {
  Loader2Icon,
  SendIcon,
  PlusIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { Section, SmallCard } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  channel: string;
  version: number;
  tags: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface EffectivenessRow {
  templateId: string;
  templateName: string;
  channel: string;
  totalSends: number;
  totalReplies: number;
  replyRate: number;
  avgSentiment: number | null;
  bySegment: {
    segment: string | null;
    sends: number;
    replies: number;
    replyRate: number;
  }[];
}

interface AgentRun {
  id: string;
  status: string;
  input: string | null;
  output: string | null;
  liveOutput?: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

function RunPanel() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/agent");
      if (res.ok) setRecentRuns(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/outreach/agent/${id}`);
        if (!res.ok) return;
        const data: AgentRun = await res.json();
        setRun(data);
        if (data.status !== "running") {
          stopPolling();
          setRunning(false);
          loadRecent();
        }
      } catch {
        /* ignore */
      }
    },
    [stopPolling, loadRecent],
  );

  const handleRun = async () => {
    setRunning(true);
    setRun(null);
    setOutputExpanded(true);
    try {
      const res = await fetch("/api/outreach/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt || undefined }),
      });
      if (!res.ok) throw new Error("Failed to start");
      const { runId: id } = await res.json();
      setRunId(id);
      setRun({
        id,
        status: "running",
        input: prompt || null,
        output: null,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        createdAt: new Date().toISOString(),
      });
      pollRef.current = setInterval(() => poll(id), 4000);
    } catch {
      setRunning(false);
    }
  };

  useEffect(() => () => stopPolling(), [stopPolling]);

  const activeRun = run;
  const liveText = activeRun?.liveOutput || activeRun?.output;
  const statusColor =
    activeRun?.status === "success"
      ? "text-success"
      : activeRun?.status === "failed"
        ? "text-destructive"
        : "text-primary";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => setExpanded((s) => !s)}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "size-2 rounded-full",
              running ? "animate-pulse bg-primary" : "bg-muted-foreground/30",
            )}
          />
          <span className="text-sm font-medium">Outreach Agent</span>
          <span className="text-xs text-muted-foreground">
            claude-code · /cold-email · /gameye-read-the-room
          </span>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
          )}
          {expanded ? (
            <ChevronUpIcon className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Custom prompt (optional)
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Draft outreach for today's leads in ~/outreach/ — check processed_leads.json first to avoid duplicates."
              rows={2}
              className="resize-none"
              disabled={running}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleRun} disabled={running}>
              {running ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <PlayIcon className="size-3.5" /> Run Agent
                </>
              )}
            </Button>
            {activeRun && (
              <span className={cn("text-xs font-medium", statusColor)}>
                {activeRun.status}
                {activeRun.durationMs &&
                  ` · ${(activeRun.durationMs / 1000).toFixed(0)}s`}
              </span>
            )}
          </div>

          {/* Live output */}
          {liveText && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setOutputExpanded((s) => !s)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {outputExpanded ? (
                  <ChevronUpIcon className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
                {outputExpanded ? "Hide output" : "Show output"}
              </button>
              {outputExpanded && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                  {liveText}
                </pre>
              )}
            </div>
          )}

          {/* Recent runs */}
          {recentRuns.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Recent runs</p>
              <div className="space-y-1">
                {recentRuns.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRun(r);
                      setOutputExpanded(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        r.status === "success"
                          ? "bg-success"
                          : r.status === "failed"
                            ? "bg-destructive"
                            : "bg-primary",
                      )}
                    />
                    <span className="flex-1 text-xs text-muted-foreground">
                      {r.startedAt
                        ? new Date(r.startedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.durationMs
                        ? `${(r.durationMs / 1000).toFixed(0)}s`
                        : r.status}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OutreachPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [effectiveness, setEffectiveness] = useState<EffectivenessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    body: "",
    channel: "email",
    tags: "[]",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [tRes, eRes] = await Promise.all([
        fetch("/api/outreach/templates"),
        fetch("/api/outreach/effectiveness"),
      ]);
      if (!tRes.ok) throw new Error("Failed to load templates");
      if (!eRes.ok) throw new Error("Failed to load effectiveness data");
      setTemplates(await tRes.json());
      setEffectiveness(await eRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/outreach/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to create template");
      setShowForm(false);
      setFormData({ name: "", subject: "", body: "", channel: "email", tags: "[]" });
      setLoading(true);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  const getStats = (templateId: string) =>
    effectiveness.find((e) => e.templateId === templateId);

  return (
    <PageShell
      title="Outreach"
      description="Email templates and send effectiveness by ICP segment"
      actions={
        <Button size="sm" onClick={() => setShowForm(true)}>
          <PlusIcon className="size-3.5" />
          New Template
        </Button>
      }
    >
      <div className="space-y-6 p-6">
        <RunPanel />

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-sm font-medium text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  fetchData();
                }}
                className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !error && templates.length === 0 && !showForm && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
                <SendIcon className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No outreach templates yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create your first email template to start tracking outreach
                effectiveness.
              </p>
            </div>
          </div>
        )}

        {showForm && (
          <Section className="mx-auto max-w-xl">
            <h2 className="mb-4 text-sm font-semibold">New Template</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Cold Outreach - Game Studios"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Subject
                </label>
                <Input
                  value={formData.subject}
                  onChange={(e) =>
                    setFormData({ ...formData, subject: e.target.value })
                  }
                  placeholder="e.g., Quick question about {{company}}"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Channel
                </label>
                <Select
                  value={formData.channel}
                  onValueChange={(value) =>
                    setFormData({ ...formData, channel: value ?? "email" })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Body (Markdown)
                </label>
                <Textarea
                  value={formData.body}
                  onChange={(e) =>
                    setFormData({ ...formData, body: e.target.value })
                  }
                  rows={6}
                  className="font-mono"
                  placeholder={"Hi {{contact_name}},\n\nI noticed {{company}} is..."}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tags (JSON array)
                </label>
                <Input
                  value={formData.tags}
                  onChange={(e) =>
                    setFormData({ ...formData, tags: e.target.value })
                  }
                  className="font-mono"
                  placeholder='["cold-outreach", "game-studio"]'
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={
                    submitting ||
                    !formData.name ||
                    !formData.subject ||
                    !formData.body
                  }
                >
                  {submitting ? "Creating..." : "Create Template"}
                </Button>
              </div>
            </div>
          </Section>
        )}

        {!loading && !error && templates.length > 0 && !showForm && (
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.map((template) => {
              const stats = getStats(template.id);
              const tags = (() => {
                try {
                  return JSON.parse(template.tags);
                } catch {
                  return [];
                }
              })();
              return (
                <SmallCard key={template.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">
                        {template.name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {template.subject}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {template.channel}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">Sends</span>
                      <p className="font-semibold">{stats?.totalSends ?? 0}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Replies</span>
                      <p className="font-semibold">{stats?.totalReplies ?? 0}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reply Rate</span>
                      <p className="font-semibold">
                        {stats && stats.totalSends > 0
                          ? `${(stats.replyRate * 100).toFixed(1)}%`
                          : "--"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sentiment</span>
                      <p className="font-semibold">
                        {stats?.avgSentiment != null
                          ? stats.avgSentiment > 0.3
                            ? "Positive"
                            : stats.avgSentiment < -0.3
                              ? "Negative"
                              : "Neutral"
                          : "--"}
                      </p>
                    </div>
                  </div>
                  {stats && stats.bySegment.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                        By Segment
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                        {stats.bySegment.map((seg, i) => (
                          <span key={i} className="text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {seg.segment ?? "unset"}
                            </span>{" "}
                            {seg.sends}s / {seg.replies}r
                            {seg.sends > 0 &&
                              ` (${(seg.replyRate * 100).toFixed(0)}%)`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    v{template.version} · {template.status} · updated{" "}
                    {new Date(template.updatedAt).toLocaleDateString()}
                  </div>
                </SmallCard>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
