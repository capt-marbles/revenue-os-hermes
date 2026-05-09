"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DocumentCard,
  type Document,
} from "@/components/documents/document-card";
import { Search, FileText, Loader2, X } from "lucide-react";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (q?: string) => {
    try {
      const params = new URLSearchParams();
      if (q?.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/documents?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load documents");
      const data = await res.json();
      setDocuments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      fetchDocuments(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, fetchDocuments]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const resultCount = documents.length;

  return (
    <PageShell
      title="Documents"
      description="Output archive from agent runs"
    >
      <div className="p-6">
        {loading && documents.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => fetchDocuments()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search documents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              {search && !loading && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {resultCount} result{resultCount !== 1 ? "s" : ""}
                </span>
              )}
              {loading && documents.length > 0 && (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Document list or empty state */}
            {documents.length === 0 ? (
              search ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Search className="mb-2 size-5 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No documents match &ldquo;{search}&rdquo;
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 py-20">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
                    <FileText className="size-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">No documents yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Run an agent to generate your first document.
                    </p>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    isExpanded={expandedId === doc.id}
                    onToggle={() => handleToggle(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
