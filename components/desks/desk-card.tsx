"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Megaphone, Target, Wrench, Crown, Briefcase, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Desk {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  global: number;
  agentCount: number;
}

const iconMap: Record<string, LucideIcon> = {
  megaphone: Megaphone,
  target: Target,
  wrench: Wrench,
  crown: Crown,
  briefcase: Briefcase,
  telescope: Target,
  "pen-tool": Megaphone,
  "shield-check": Wrench,
};

const colorMap: Record<string, { border: string; bg: string }> = {
  blue: { border: "border-l-blue-500", bg: "bg-blue-500/5" },
  emerald: { border: "border-l-emerald-500", bg: "bg-emerald-500/5" },
  violet: { border: "border-l-violet-500", bg: "bg-violet-500/5" },
  amber: { border: "border-l-amber-500", bg: "bg-amber-500/5" },
  // CSS class format from DB
  "text-blue-400": { border: "border-l-blue-400", bg: "bg-blue-400/5" },
  "text-emerald-400": { border: "border-l-emerald-400", bg: "bg-emerald-400/5" },
  "text-violet-400": { border: "border-l-violet-400", bg: "bg-violet-400/5" },
  "text-amber-400": { border: "border-l-amber-400", bg: "bg-amber-400/5" },
  "text-red-400": { border: "border-l-red-400", bg: "bg-red-400/5" },
  "text-green-400": { border: "border-l-green-400", bg: "bg-green-400/5" },
  "text-cyan-400": { border: "border-l-cyan-400", bg: "bg-cyan-400/5" },
  "text-pink-400": { border: "border-l-pink-400", bg: "bg-pink-400/5" },
};

export function DeskCard({ desk }: { desk: Desk }) {
  const router = useRouter();
  const colors = desk.color ? colorMap[desk.color] : null;

  return (
    <Card
      className={cn(
        "cursor-pointer border-l-4 transition-all hover:ring-2 hover:ring-ring/20",
        colors ? `${colors.border} ${colors.bg}` : "border-l-border"
      )}
      onClick={() => router.push(`/desk/${desk.slug}/copilot`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/desk/${desk.slug}/copilot`);
        }
      }}
      aria-label={`Open ${desk.name} desk`}
    >
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold leading-tight">{desk.name}</h3>
            {desk.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                {desk.description}
              </p>
            )}
          </div>
          {desk.icon && (() => {
            const Icon = iconMap[desk.icon] || Briefcase;
            const dotColor = desk.color ? colorMap[desk.color]?.border.replace("border-l-", "text-") : "text-muted-foreground";
            return (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted ml-3">
                <Icon className={cn("size-5", dotColor)} aria-hidden="true" />
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[11px] gap-1">
            <Bot className="size-3" />
            {desk.global ? "All" : desk.agentCount} agent{desk.agentCount !== 1 ? "s" : ""}
          </Badge>
          {desk.global === 1 && (
            <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30">
              Cross-desk visibility
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
