"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { CRON_PRESETS } from "@/lib/scheduler/cron-utils";

interface Target {
  id: string;
  name: string;
}

interface ScheduleFormProps {
  onCreated: () => void;
}

const PRESET_KEYS = [
  "daily-9am",
  "weekdays-9am",
  "weekly-monday",
  "weekly-friday",
  "monthly",
  "every-6h",
  "every-12h",
] as const;

export function ScheduleForm({ onCreated }: ScheduleFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState<"agent" | "sequence">("agent");
  const [targetId, setTargetId] = useState("");
  const [input, setInput] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("daily-9am");
  const [customCron, setCustomCron] = useState("");
  const [useCustomCron, setUseCustomCron] = useState(false);

  // Targets loaded from API
  const [agents, setAgents] = useState<Target[]>([]);
  const [sequences, setSequences] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);

  const targets = type === "agent" ? agents : sequences;
  const cronValue = useCustomCron ? customCron : CRON_PRESETS[selectedPreset]?.cron ?? "0 9 * * *";

  // Fetch targets when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingTargets(true);
    Promise.all([
      fetch("/api/agents").then((r) => r.ok ? r.json() : []),
      fetch("/api/sequences").then((r) => r.ok ? r.json() : []),
    ])
      .then(([agentData, sequenceData]) => {
        setAgents(
          Array.isArray(agentData)
            ? agentData.map((a: any) => ({ id: a.id, name: a.name }))
            : []
        );
        setSequences(
          Array.isArray(sequenceData)
            ? sequenceData.map((p: any) => ({ id: p.id, name: p.name }))
            : []
        );
      })
      .catch(() => {})
      .finally(() => setLoadingTargets(false));
  }, [open]);

  // Reset targetId when type changes
  useEffect(() => {
    setTargetId("");
  }, [type]);

  const resetForm = useCallback(() => {
    setName("");
    setType("agent");
    setTargetId("");
    setInput("");
    setSelectedPreset("daily-9am");
    setCustomCron("");
    setUseCustomCron(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !targetId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          targetId,
          input: input.trim(),
          cron: cronValue,
        }),
      });
      if (!res.ok) throw new Error("Failed to create schedule");
      resetForm();
      setOpen(false);
      onCreated();
    } catch (err) {
      console.error("Failed to create schedule:", err);
      toast.error("Failed to create schedule");
    } finally {
      setSaving(false);
    }
  }, [name, type, targetId, input, cronValue, resetForm, onCreated]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus className="size-3.5" />
            New Schedule
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Schedule</DialogTitle>
          <DialogDescription>
            Run an agent or sequence on a recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              placeholder="e.g. Daily lead enrichment"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button
                variant={type === "agent" ? "default" : "outline"}
                size="sm"
                onClick={() => setType("agent")}
                type="button"
              >
                Agent
              </Button>
              <Button
                variant={type === "sequence" ? "default" : "outline"}
                size="sm"
                onClick={() => setType("sequence")}
                type="button"
              >
                Sequence
              </Button>
            </div>
          </div>

          {/* Target picker */}
          <div className="space-y-1.5">
            <Label>
              {type === "agent" ? "Agent" : "Sequence"}
            </Label>
            {loadingTargets ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="size-3 animate-spin" />
                Loading...
              </div>
            ) : (
              <Select value={targetId} onValueChange={(v) => v && setTargetId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Select ${type}...`} />
                </SelectTrigger>
                <SelectContent>
                  {targets.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      No {type}s found
                    </div>
                  ) : (
                    targets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Input / prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-input">Input / Prompt</Label>
            <Textarea
              id="schedule-input"
              placeholder={
                type === "agent"
                  ? "e.g. Check for new leads and enrich them"
                  : "e.g. { \"source\": \"crm\" }"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-20"
            />
          </div>

          {/* Cron expression */}
          <div className="space-y-1.5">
            <Label>Schedule</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_KEYS.map((key) => {
                const preset = CRON_PRESETS[key];
                if (!preset) return null;
                return (
                  <Button
                    key={key}
                    variant={!useCustomCron && selectedPreset === key ? "default" : "outline"}
                    size="xs"
                    onClick={() => {
                      setSelectedPreset(key);
                      setUseCustomCron(false);
                    }}
                    type="button"
                  >
                    {preset.label}
                  </Button>
                );
              })}
              <Button
                variant={useCustomCron ? "default" : "outline"}
                size="xs"
                onClick={() => setUseCustomCron(true)}
                type="button"
              >
                Custom
              </Button>
            </div>
            {useCustomCron && (
              <Input
                placeholder="e.g. 30 8 * * 1-5"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !targetId}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? "Creating..." : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
