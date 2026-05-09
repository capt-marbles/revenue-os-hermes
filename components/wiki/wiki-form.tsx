"use client";

import { useCallback, useState } from "react";
import { Loader2 as Loader2Icon, Plus as PlusIcon } from "lucide-react";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CATEGORIES, CATEGORY_LABELS } from "./wiki-entry-card";

interface WikiFormProps {
  category: string;
  deskId: string;
  onSubmit: (data: {
    deskId: string;
    title: string;
    category: string;
    content: string;
    tags: string[];
    confidence: string;
  }) => Promise<void>;
}

export function WikiForm({ category, deskId, onSubmit }: WikiFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(category);
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setContent("");
    setTagsInput("");
    setConfidence("medium");
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        setSelectedCategory(category);
      } else {
        reset();
      }
    },
    [category, reset]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || !content.trim()) return;

      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      setSubmitting(true);
      try {
        await onSubmit({
          deskId,
          title: title.trim(),
          category: selectedCategory,
          content: content.trim(),
          tags,
          confidence,
        });
        reset();
        setOpen(false);
      } finally {
        setSubmitting(false);
      }
    },
    [deskId, title, selectedCategory, content, tagsInput, confidence, onSubmit, reset]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon className="size-3.5" />
        Add Entry
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Wiki Entry</DialogTitle>
            <DialogDescription>
              Add structured knowledge that the Director can reference during
              agent runs.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wiki-title">Title</Label>
              <Input
                id="wiki-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Competitor pricing analysis"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-category">Category</Label>
              <Select
                value={selectedCategory}
                onValueChange={(v) => { if (v) setSelectedCategory(v); }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-content">Content</Label>
              <Textarea
                id="wiki-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter knowledge content..."
                rows={8}
                className="min-h-[8lh] resize-y font-mono text-[13px] leading-relaxed"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-tags">Tags</Label>
              <Input
                id="wiki-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="pricing, enterprise, competitor (comma-separated)"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-confidence">Confidence</Label>
              <Select value={confidence} onValueChange={(v) => { if (v) setConfidence(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      High
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-amber-500" />
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-red-500" />
                      Low
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || !title.trim() || !content.trim()}
            >
              {submitting && <Loader2Icon className="size-3.5 animate-spin" />}
              Create Entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
