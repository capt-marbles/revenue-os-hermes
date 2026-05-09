"use client";

import { useCallback, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Loader2 as Loader2Icon,
  Save as SaveIcon,
  Trash2 as Trash2Icon,
  BookOpen as BookOpenIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export interface WikiEntry {
  id: string;
  tenantId: string;
  deskId: string;
  slug: string;
  title: string;
  category:
    | "competitor"
    | "icp_segment"
    | "tactic"
    | "insight"
    | "process"
    | "reference";
  content: string;
  tags: string;
  sourceRunIds: string;
  confidence: "low" | "medium" | "high";
  lastReferencedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CATEGORIES = [
  "competitor",
  "icp_segment",
  "tactic",
  "insight",
  "process",
  "reference",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  competitor: "Competitors",
  icp_segment: "ICP Segments",
  tactic: "Tactics",
  insight: "Insights",
  process: "Processes",
  reference: "References",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-red-500",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

interface WikiEntryCardProps {
  entry: WikiEntry;
  onSave: (
    id: string,
    data: { title: string; content: string }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WikiEntryCard({ entry, onSave, onDelete }: WikiEntryCardProps) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = title !== entry.title || content !== entry.content;

  const parsedTags: string[] = (() => {
    try {
      return JSON.parse(entry.tags || "[]");
    } catch {
      return [];
    }
  })();

  const sourceCount: number = (() => {
    try {
      return JSON.parse(entry.sourceRunIds || "[]").length;
    } catch {
      return 0;
    }
  })();

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      await onSave(entry.id, { title, content });
    } finally {
      setSaving(false);
    }
  }, [entry.id, title, content, isDirty, onSave]);

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

  const timeAgo = formatDistanceToNow(new Date(entry.updatedAt), {
    addSuffix: true,
  });

  return (
    <Card onKeyDown={handleKeyDown}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${CONFIDENCE_COLORS[entry.confidence]}`}
            title={CONFIDENCE_LABELS[entry.confidence]}
          />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 border-transparent bg-transparent px-1 text-base font-medium hover:border-input focus-visible:border-ring"
            aria-label="Entry title"
          />
        </CardTitle>
        <CardAction>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete entry"
                />
              }
            >
              <Trash2Icon className="size-3.5 text-muted-foreground" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete wiki entry</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete &ldquo;{entry.title}&rdquo;?
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting && (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className="min-h-[8lh] resize-y font-mono text-[13px] leading-relaxed"
          placeholder="Enter content..."
          aria-label="Entry content"
        />
        {parsedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {parsedTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[11px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {CATEGORY_LABELS[entry.category] ?? entry.category}
          </Badge>
          {sourceCount > 0 && (
            <span className="flex items-center gap-1">
              <BookOpenIcon className="size-3" />
              {sourceCount} agent run{sourceCount !== 1 ? "s" : ""}
            </span>
          )}
          <span>Updated {timeAgo}</span>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
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
