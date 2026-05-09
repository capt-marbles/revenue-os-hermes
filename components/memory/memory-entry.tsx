"use client";

import { useCallback, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2Icon, SaveIcon, Trash2Icon, ShieldIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface MemoryEntry {
  id: string;
  tenantId: string;
  category:
    | "icp"
    | "brand_voice"
    | "competitors"
    | "tools"
    | "connectors"
    | "custom";
  key: string;
  value: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryEntryCardProps {
  entry: MemoryEntry;
  onSave: (id: string, data: { key: string; value: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function MemoryEntryCard({
  entry,
  onSave,
  onDelete,
}: MemoryEntryCardProps) {
  const [key, setKey] = useState(entry.key);
  const [value, setValue] = useState(entry.value);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = key !== entry.key || value !== entry.value;

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      await onSave(entry.id, { key, value });
    } finally {
      setSaving(false);
    }
  }, [entry.id, key, value, isDirty, onSave]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete(entry.id);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }, [entry.id, onDelete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  const isProtected = entry.category === "brand_voice";
  const updatedLabel = entry.updatedBy === "agent" ? "agent" : "human";
  const timeAgo = formatDistanceToNow(new Date(entry.updatedAt), {
    addSuffix: true,
  });

  return (
    <Card onKeyDown={handleKeyDown}>
      <CardHeader>
        <CardTitle>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-7 border-transparent bg-transparent px-1 text-base font-medium hover:border-input focus-visible:border-ring"
            aria-label="Entry key"
          />
        </CardTitle>
        <CardAction>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Delete entry" />
              }
            >
              <Trash2Icon className="size-3.5 text-muted-foreground" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete entry</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete &ldquo;{entry.key}&rdquo;? This
                  action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" />}
                >
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting && <Loader2Icon className="size-3.5 animate-spin" />}
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={12}
          className="min-h-[12lh] resize-y font-mono text-[13px] leading-relaxed"
          placeholder="Enter value (markdown supported)..."
          aria-label="Entry value"
        />
      </CardContent>
      <CardFooter className="justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isProtected && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400" title="Protected — only editable by you, not agents">
              <ShieldIcon className="size-3" />
              Protected
            </span>
          )}
          <span>
            Updated by{" "}
            <span className="font-medium text-foreground">{updatedLabel}</span>{" "}
            {timeAgo}
          </span>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SaveIcon className="size-3.5" />
          )}
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
