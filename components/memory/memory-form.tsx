"use client";

import { useCallback, useState } from "react";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const CATEGORY_LABELS: Record<string, string> = {
  icp: "ICP",
  brand_voice: "Brand Voice",
  competitors: "Competitors",
  tools: "Tools",
  connectors: "Connectors",
  custom: "Custom",
};

interface MemoryFormProps {
  category: string;
  onSubmit: (data: {
    category: string;
    key: string;
    value: string;
  }) => Promise<void>;
}

export function MemoryForm({ category, onSubmit }: MemoryFormProps) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setKey("");
    setValue("");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!key.trim() || !value.trim()) return;

      setSubmitting(true);
      try {
        await onSubmit({ category, key: key.trim(), value: value.trim() });
        reset();
        setOpen(false);
      } finally {
        setSubmitting(false);
      }
    },
    [category, key, value, onSubmit, reset]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" size="sm" />}
      >
        <PlusIcon className="size-3.5" />
        Add Entry
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Memory Entry</DialogTitle>
            <DialogDescription>
              Add a new entry to shared memory that all agents can access.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="memory-category">Category</Label>
              <div>
                <Badge variant="secondary">
                  {CATEGORY_LABELS[category] ?? category}
                </Badge>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-key">Key</Label>
              <Input
                id="memory-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. target_persona, tone_guidelines"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-value">Value</Label>
              <Textarea
                id="memory-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter value (markdown supported)..."
                rows={8}
                className="min-h-[8lh] resize-y font-mono text-[13px] leading-relaxed"
                required
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || !key.trim() || !value.trim()}
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
