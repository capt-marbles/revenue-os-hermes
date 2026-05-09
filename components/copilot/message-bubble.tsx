"use client";

import { memo, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BrainCircuit, Check, Copy, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionCard } from "./action-card";
import { getActionKey } from "@/lib/copilot/action-key";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MessageBubbleProps {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  deskId?: string;
  actionDecisions?: Record<
    string,
    { status: "approved" | "dismissed"; resultMessage?: string | null }
  >;
}

function renderMarkdown(
  raw: string,
  conversationId: string,
  messageId: string,
  actionDecisions: Record<
    string,
    { status: "approved" | "dismissed"; resultMessage?: string | null }
  >,
  deskId?: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const actionRegex =
    /\*\*Recommended Action\*\*:\s*([\s\S]*?)(?=\n\n|\n\*\*Recommended Action\*\*|$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <MarkdownBlock
          key={`md-${lastIndex}`}
          text={raw.slice(lastIndex, match.index)}
        />,
      );
    }

    const actionText = match[1].trim();
    const actionKey = getActionKey(actionText);
    nodes.push(
      <ActionCard
        key={`action-${match.index}`}
        conversationId={conversationId}
        messageId={messageId}
        actionText={actionText}
        deskId={deskId}
        persistedDecision={actionDecisions[actionKey]}
      />,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    nodes.push(<MarkdownBlock key={`md-${lastIndex}`} text={raw.slice(lastIndex)} />);
  }

  return nodes;
}

function MarkdownBlock({ text }: { text: string }) {
  const html = useMemo(() => markdownToHtml(text), [text]);
  return (
    <div
      className="prose-copilot"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function markdownToHtml(text: string): string {
  let html = text;

  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) =>
      `<pre class="copilot-code"><code>${escapeHtml(code.trim())}</code></pre>`,
  );

  html = html.replace(
    /`([^`]+)`/g,
    '<code class="copilot-inline-code">$1</code>',
  );

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter(Boolean);
    if (rows.length < 2) return tableBlock;

    const toRow = (row: string, tag: "th" | "td") =>
      "<tr>" +
      row
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => `<${tag}>${c.trim()}</${tag}>`)
        .join("") +
      "</tr>";

    const headerRow = toRow(rows[0], "th");
    const startIdx = /^[\s|:-]+$/.test(rows[1]) ? 2 : 1;
    const bodyRows = rows
      .slice(startIdx)
      .map((r) => toRow(r, "td"))
      .join("");

    return `<table class="copilot-table"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
  });

  html = html.replace(/((?:^[\t ]*[-*]\s.+$\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => l.replace(/^[\t ]*[-*]\s/, "").trim())
      .map((l) => `<li>${l}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });

  html = html.replace(/\n{2,}/g, "</p><p>");
  if (!html.startsWith("<")) html = "<p>" + html;
  if (!html.endsWith(">")) html += "</p>";
  html = html.replace(/(?<!\>)\n(?!\<)/g, "<br/>");

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const MessageBubble = memo(function MessageBubble({
  id,
  conversationId,
  role,
  content,
  createdAt,
  isStreaming,
  deskId,
  actionDecisions = {},
}: MessageBubbleProps) {
  const isUser = role === "user";
  const timestamp = createdAt
    ? formatDistanceToNow(new Date(createdAt), { addSuffix: true })
    : "";
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } else {
      const el = document.createElement("textarea");
      el.value = content;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className={cn(
        "group flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted ring-1 ring-foreground/5",
        )}
      >
        {isUser ? (
          <User className="size-3.5" />
        ) : (
          <BrainCircuit className="size-3.5 text-muted-foreground" />
        )}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", isUser && "items-end")}>
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                className={cn(
                  "relative min-w-0 rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isUser
                    ? "max-w-[80%] rounded-br-md bg-primary text-primary-foreground"
                    : "max-w-full flex-1 rounded-bl-md bg-muted/60",
                )}
              />
            }
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : (
              <RenderedContent
                content={content}
                conversationId={conversationId}
                id={id}
                actionDecisions={actionDecisions}
                deskId={deskId}
              />
            )}
            {isStreaming && (
              <span className="typing-dots">
                <span />
                <span />
                <span />
              </span>
            )}
          </TooltipTrigger>
          {timestamp && (
            <TooltipContent side="bottom">
              <span>{timestamp}</span>
            </TooltipContent>
          )}
        </Tooltip>

        {!isStreaming && content && (
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-opacity",
              "text-muted-foreground hover:text-foreground",
              "opacity-0 group-hover:opacity-100",
            )}
            aria-label="Copy message"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
});

const RenderedContent = memo(function RenderedContent({
  content,
  conversationId,
  id,
  actionDecisions,
  deskId,
}: {
  content: string;
  conversationId: string;
  id: string;
  actionDecisions: Record<string, { status: "approved" | "dismissed"; resultMessage?: string | null }>;
  deskId?: string;
}) {
  const nodes = useMemo(
    () => renderMarkdown(content, conversationId, id, actionDecisions, deskId),
    [content, conversationId, id, actionDecisions, deskId],
  );
  return <div className="space-y-1">{nodes}</div>;
});
