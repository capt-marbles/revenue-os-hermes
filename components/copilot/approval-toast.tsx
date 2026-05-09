"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Shield, X, Check, Ban, Clock, Infinity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalRequest } from "@/lib/approval-store";

interface ApprovalToastProps {
  approval: ApprovalRequest;
  onResolve: (id: string, choice: "once" | "session" | "always" | "deny") => void;
  onDismiss: (id: string) => void;
}

export function ApprovalToast({ approval, onResolve, onDismiss }: ApprovalToastProps) {
  const [expanded, setExpanded] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  if (approval.status !== "pending") return null;

  const handleResolve = async (choice: "once" | "session" | "always" | "deny") => {
    setResolving(choice);
    try {
      await onResolve(approval.id, choice);
    } finally {
      setResolving(null);
    }
  };

  // Truncate command for display
  const commandPreview =
    approval.command.length > 120
      ? approval.command.slice(0, 117) + "..."
      : approval.command;

  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)]",
        "border border-amber-500/30 bg-amber-950/80 backdrop-blur-md",
        "rounded-lg shadow-2xl shadow-amber-900/20",
        "font-mono text-sm",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-amber-500/20">
        <Shield className="size-4 text-amber-400 shrink-0" />
        <span className="text-amber-200 text-xs tracking-widest uppercase font-bold flex-1">
          Approval Required
        </span>
        <span className="text-amber-500/60 text-[10px] tracking-wider uppercase">
          {approval.deskId}
        </span>
        <button
          onClick={() => onDismiss(approval.id)}
          className="text-amber-500/40 hover:text-amber-300 transition-colors ml-1"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Description */}
        <p className="text-amber-100/80 text-xs leading-relaxed">
          {approval.description}
        </p>

        {/* Command */}
        <div className="bg-black/40 rounded border border-amber-500/10 px-3 py-2">
          <code className="text-amber-200/90 text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">
            {commandPreview}
          </code>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-1.5 text-amber-500/40 text-[10px] tracking-wider">
          <Clock className="size-3" />
          {new Date(approval.createdAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 pb-3">
        <button
          onClick={() => handleResolve("once")}
          disabled={resolving !== null}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wider uppercase font-bold",
            "bg-amber-500/20 text-amber-200 border border-amber-500/30",
            "hover:bg-amber-500/30 hover:text-amber-100",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors",
          )}
        >
          <Check className="size-3" />
          {resolving === "once" ? "..." : "Once"}
        </button>

        <button
          onClick={() => handleResolve("session")}
          disabled={resolving !== null}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wider uppercase font-bold",
            "bg-amber-500/15 text-amber-300 border border-amber-500/20",
            "hover:bg-amber-500/25 hover:text-amber-200",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors",
          )}
        >
          <Clock className="size-3" />
          {resolving === "session" ? "..." : "Session"}
        </button>

        <button
          onClick={() => handleResolve("always")}
          disabled={resolving !== null}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wider uppercase font-bold",
            "bg-amber-500/15 text-amber-300 border border-amber-500/20",
            "hover:bg-amber-500/25 hover:text-amber-200",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors",
          )}
        >
          <Infinity className="size-3" />
          {resolving === "always" ? "..." : "Always"}
        </button>

        <div className="flex-1" />

        <button
          onClick={() => handleResolve("deny")}
          disabled={resolving !== null}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wider uppercase font-bold",
            "bg-red-500/15 text-red-300 border border-red-500/20",
            "hover:bg-red-500/25 hover:text-red-200",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors",
          )}
        >
          <Ban className="size-3" />
          {resolving === "deny" ? "..." : "Deny"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Stack of approval toasts — shows multiple pending approvals
 * stacked vertically from the bottom-right.
 */
interface ApprovalToastStackProps {
  approvals: ApprovalRequest[];
  onResolve: (id: string, choice: "once" | "session" | "always" | "deny") => void;
  onDismiss: (id: string) => void;
}

export function ApprovalToastStack({
  approvals,
  onResolve,
  onDismiss,
}: ApprovalToastStackProps) {
  if (approvals.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-3 pointer-events-none">
      {approvals.map((approval) => (
        <div key={approval.id} className="pointer-events-auto" style={{ marginBottom: approvals.indexOf(approval) * 0 }}>
          <ApprovalToast
            approval={approval}
            onResolve={onResolve}
            onDismiss={onDismiss}
          />
        </div>
      ))}
    </div>
  );
}
