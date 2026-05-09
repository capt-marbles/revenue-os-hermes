"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, SkipForward, MessageSquare, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskApprovalProps {
  taskId: string;
  approvalStatus: string | null;
  assigneeType: string;
  onApproved: () => void;
}

export function TaskApproval({ taskId, approvalStatus, assigneeType, onApproved }: TaskApprovalProps) {
  const [loading, setLoading] = useState(false);
  const [showRedirect, setShowRedirect] = useState(false);
  const [redirectText, setRedirectText] = useState("");
  const [done, setDone] = useState(false);

  // Only show approval UI for pending tasks assigned to agents
  if (approvalStatus !== "pending" || assigneeType !== "agent") return null;

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, { method: "POST" });
      if (res.ok) {
        setDone(true);
        onApproved();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRedirect() {
    if (!redirectText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/redirect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: redirectText.trim() }),
      });
      if (res.ok) {
        setDone(true);
        setShowRedirect(false);
        onApproved();
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-emerald-600">
        <Check className="size-3" />
        Done
      </div>
    );
  }

  if (showRedirect) {
    return (
      <div className="flex items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
        <Input
          value={redirectText}
          onChange={(e) => setRedirectText(e.target.value)}
          placeholder="Do this instead..."
          className="h-6 text-[11px] flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRedirect();
            if (e.key === "Escape") setShowRedirect(false);
          }}
          autoFocus
        />
        <Button
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          onClick={handleRedirect}
          disabled={loading || !redirectText.trim()}
        >
          {loading ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1 text-[10px]"
          onClick={() => setShowRedirect(false)}
        >
          <X className="size-2.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        className="h-5 px-1.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
        onClick={handleApprove}
        disabled={loading}
      >
        {loading ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
        Approve
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px] text-muted-foreground"
        onClick={() => setShowRedirect(true)}
      >
        <MessageSquare className="size-2.5" />
        Redirect
      </Button>
    </div>
  );
}
