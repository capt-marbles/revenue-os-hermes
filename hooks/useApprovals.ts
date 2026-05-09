"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovalRequest } from "@/lib/approval-store";

interface UseApprovalsOptions {
  /** Desk slug to filter approvals for. If omitted, shows all. */
  deskId?: string;
  /** Polling interval in ms. Default: 3000 */
  pollInterval?: number;
}

/**
 * Hook for managing approval requests in a desk's copilot UI.
 * Polls the /api/approvals endpoint for pending approvals and
 * provides resolve/dismiss handlers.
 */
export function useApprovals({ deskId, pollInterval = 3000 }: UseApprovalsOptions = {}) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Poll for pending approvals
  useEffect(() => {
    let active = true;

    const fetchApprovals = async () => {
      try {
        const params = new URLSearchParams({ status: "pending" });
        if (deskId) params.set("deskId", deskId);

        const res = await fetch(`/api/approvals?${params}`);
        if (!res.ok || !active) return;

        const data = await res.json();
        const pending: ApprovalRequest[] = data.approvals || [];

        // Filter out dismissed approvals
        const visible = pending.filter((a) => !dismissed.has(a.id));
        setApprovals((prev) => {
          const sameIds =
            prev.length === visible.length &&
            prev.every((a, i) => a.id === visible[i]?.id);
          return sameIds ? prev : visible;
        });
      } catch {
        // Silently fail — approvals are non-critical
      }
    };

    fetchApprovals();
    const interval = setInterval(fetchApprovals, pollInterval);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deskId, pollInterval, dismissed]);

  // Resolve an approval via the API
  const resolveApproval = useCallback(
    async (id: string, choice: "once" | "session" | "always" | "deny") => {
      try {
        const res = await fetch(`/api/approvals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choice }),
        });

        if (res.ok) {
          // Remove from local state immediately
          setApprovals((prev) => prev.filter((a) => a.id !== id));
          setDismissed((prev) => new Set(prev).add(id));
        }
      } catch {
        // Will be cleaned up on next poll
      }
    },
    [],
  );

  // Dismiss an approval (just hide it locally, don't resolve)
  const dismissApproval = useCallback((id: string) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  return {
    approvals,
    resolveApproval,
    dismissApproval,
  };
}
