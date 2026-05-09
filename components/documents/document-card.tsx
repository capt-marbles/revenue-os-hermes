"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardHeader,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Bot,
  Clock,
  MessageSquare,
} from "lucide-react";

export interface Document {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  summary: string | null;
  agentId: string | null;
  agentRunId: string | null;
  taskId: string | null;
  tags: string;
  agentName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DocumentCardProps {
  document: Document;
  isExpanded: boolean;
  onToggle: () => void;
}

export function DocumentCard({
  document,
  isExpanded,
  onToggle,
}: DocumentCardProps) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(document.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API unavailable
      }
    },
    [document.content]
  );

  const relativeTime = formatDistanceToNow(new Date(document.createdAt), {
    addSuffix: true,
  });

  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(document.tags);
  } catch {
    // Malformed tags — ignore
  }

  return (
    <Card
      size="sm"
      className="cursor-pointer transition-shadow hover:ring-foreground/20"
      onClick={onToggle}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted mt-0.5">
              <FileText className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{document.title}</p>
                {isExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </div>
              {!isExpanded && document.summary && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {document.summary}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {document.agentName && (
              <Badge
                variant="secondary"
                className="bg-violet-500/10 text-violet-600 dark:text-violet-400"
              >
                <Bot className="size-3" data-icon="inline-start" />
                {document.agentName}
              </Badge>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
              <Clock className="size-3" />
              {relativeTime}
            </span>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3">
          {/* Full content */}
          <div className="relative">
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-foreground font-mono whitespace-pre-wrap break-words">
              {document.content}
            </pre>
            <div className="absolute right-2 top-2">
              <Button
                variant="outline"
                size="icon-xs"
                onClick={handleCopy}
                aria-label="Copy content to clipboard"
              >
                {copied ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {document.agentName && (
              <span className="flex items-center gap-1">
                <Bot className="size-3" />
                {document.agentName}
              </span>
            )}
            {parsedTags.length > 0 && (
              <div className="flex items-center gap-1">
                {parsedTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1.5">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="xs"
              className="ml-auto flex items-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/documents/${document.id}`);
              }}
            >
              <MessageSquare className="size-3" />
              Review &amp; Reply
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
