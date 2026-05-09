"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const API_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
  "sec-fetch-site": "same-origin",
};

interface StageAction {
  id: string;
  name: string;
  description: string | null;
  fromStatus: string;
  toStatus: string;
  agentId: string;
  agentName: string;
  promptTemplate: string;
  autoApprove: number;
  priority: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface FormData {
  name: string;
  description: string;
  fromStatus: string;
  toStatus: string;
  agentId: string;
  promptTemplate: string;
  autoApprove: boolean;
  priority: number;
}

const EMPTY_FORM: FormData = {
  name: "",
  description: "",
  fromStatus: "",
  toStatus: "",
  agentId: "",
  promptTemplate: "",
  autoApprove: false,
  priority: 0,
};

export default function StageActionsPage() {
  const [actions, setActions] = useState<StageAction[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/stage-actions", {
        credentials: "include",
        headers: { "sec-fetch-site": "same-origin" },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setActions(data.actions ?? []);
      // Build agent list from actions (the endpoint returns agentName enriched)
      const agentMap = new Map<string, string>();
      for (const a of data.actions ?? []) {
        if (a.agentId && a.agentName && !agentMap.has(a.agentId)) {
          agentMap.set(a.agentId, a.agentName);
        }
      }
      setAgents(
        Array.from(agentMap, ([id, name]) => ({ id, name })),
      );
    } catch {
      toast.error("Failed to load stage actions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (action: StageAction) => {
    setEditingId(action.id);
    setForm({
      name: action.name,
      description: action.description ?? "",
      fromStatus: action.fromStatus,
      toStatus: action.toStatus,
      agentId: action.agentId,
      promptTemplate: action.promptTemplate,
      autoApprove: action.autoApprove === 1,
      priority: action.priority,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.toStatus.trim() || !form.agentId.trim()) {
      toast.error("Name, To Status, and Agent are required");
      return;
    }

    setSaving(true);
    try {
      const body = {
        ...form,
        fromStatus: form.fromStatus || "*",
      };

      if (editingId) {
        const res = await fetch(`/api/pipeline/stage-actions/${editingId}`, {
          method: "PATCH",
          credentials: "include",
          headers: API_HEADERS,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Update failed");
        toast.success("Stage action updated");
      } else {
        const res = await fetch("/api/pipeline/stage-actions", {
          method: "POST",
          credentials: "include",
          headers: API_HEADERS,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Create failed");
        toast.success("Stage action created");
      }

      setDialogOpen(false);
      fetchData();
    } catch {
      toast.error(editingId ? "Failed to update" : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/pipeline/stage-actions/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "sec-fetch-site": "same-origin" },
      });
      if (!res.ok) throw new Error();
      setActions((prev) => prev.filter((a) => a.id !== id));
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  const statusColor = (s: string) =>
    s === "active"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";

  return (
    <PageShell
      title="Pipeline Stage Actions"
      description="Configure what agents run when opportunities change status"
      actions={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4 mr-1" />
            Create New
          </Button>
          <DialogContent className="sm:max-w-[560px] bg-gray-900 border-gray-700">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Stage Action" : "New Stage Action"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="sa-name">Name</Label>
                <Input
                  id="sa-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Scout: Enrich new lead"
                  className="bg-gray-800 border-gray-600"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sa-desc">Description (optional)</Label>
                <Textarea
                  id="sa-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What this action does"
                  className="bg-gray-800 border-gray-600"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="sa-from">From Status</Label>
                  <Input
                    id="sa-from"
                    value={form.fromStatus}
                    onChange={(e) => setForm((f) => ({ ...f, fromStatus: e.target.value }))}
                    placeholder="empty = any (* )"
                    className="bg-gray-800 border-gray-600"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sa-to">To Status</Label>
                  <Input
                    id="sa-to"
                    value={form.toStatus}
                    onChange={(e) => setForm((f) => ({ ...f, toStatus: e.target.value }))}
                    placeholder="use * for wildcard"
                    className="bg-gray-800 border-gray-600"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Agent</Label>
                <Select
                  value={form.agentId}
                  onValueChange={(v) => setForm((f) => ({ ...f, agentId: v as string }))}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-600">
                    <SelectValue placeholder="Select agent..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sa-prompt">Prompt Template</Label>
                <Textarea
                  id="sa-prompt"
                  value={form.promptTemplate}
                  onChange={(e) => setForm((f) => ({ ...f, promptTemplate: e.target.value }))}
                  placeholder="The prompt sent to the agent when this stage transition fires..."
                  className="bg-gray-800 border-gray-600 font-mono text-sm"
                  rows={5}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="sa-auto"
                    checked={form.autoApprove}
                    onChange={(e) => setForm((f) => ({ ...f, autoApprove: e.target.checked }))}
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  <Label htmlFor="sa-auto">Auto-approve</Label>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sa-priority">Priority</Label>
                  <Input
                    id="sa-priority"
                    type="number"
                    min={0}
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))
                    }
                    className="bg-gray-800 border-gray-600"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
                  {editingId ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : actions.length === 0 ? (
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="py-12 text-center text-muted-foreground">
              No stage actions configured yet. Click &quot;Create New&quot; to add one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_120px_100px_70px_70px_100px] gap-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Name</span>
              <span>From → To</span>
              <span>Agent</span>
              <span className="text-center">Priority</span>
              <span className="text-center">Status</span>
              <span className="text-right">Actions</span>
            </div>

            {actions.map((action) => (
              <Card
                key={action.id}
                className="bg-gray-900 border-gray-800 hover:border-gray-600 transition-colors"
              >
                <CardContent className="py-3 px-4">
                  <div className="grid grid-cols-[1fr_120px_100px_70px_70px_100px] gap-3 items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{action.name}</p>
                      {action.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {action.description}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{action.fromStatus}</span>
                      <span className="mx-1">→</span>
                      <span className="font-mono">{action.toStatus}</span>
                    </div>
                    <div className="text-xs truncate">{action.agentName}</div>
                    <div className="text-center text-xs">{action.priority}</div>
                    <div className="flex justify-center">
                      <Badge
                        variant="outline"
                        className={statusColor(action.status)}
                      >
                        {action.status}
                      </Badge>
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(action)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleDelete(action.id)}
                        disabled={deleting === action.id}
                      >
                        {deleting === action.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
