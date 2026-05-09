import * as React from "react";

import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger";

const toneClasses: Record<Tone, string> = {
  default: "border-border bg-card",
  success: "border-success/30 bg-success/[0.06]",
  warning: "border-warning/30 bg-warning/[0.06]",
  danger: "border-danger/30 bg-danger/[0.06]",
};

const mutedToneClasses: Record<Tone, string> = {
  default: "border-border bg-background/50",
  success: "border-success/25 bg-success/[0.04]",
  warning: "border-warning/25 bg-warning/[0.04]",
  danger: "border-danger/25 bg-danger/[0.04]",
};

interface SectionProps extends React.ComponentProps<"section"> {
  tone?: Tone;
}

function Section({ className, tone = "default", ...props }: SectionProps) {
  return (
    <section
      data-slot="section"
      data-tone={tone}
      className={cn("rounded-2xl border p-5", toneClasses[tone], className)}
      {...props}
    />
  );
}

interface CardLikeProps extends React.ComponentProps<"div"> {
  tone?: Tone;
}

function SmallCard({ className, tone = "default", ...props }: CardLikeProps) {
  return (
    <div
      data-slot="small-card"
      data-tone={tone}
      className={cn("rounded-xl border p-4", toneClasses[tone], className)}
      {...props}
    />
  );
}

function MutedCard({ className, tone = "default", ...props }: CardLikeProps) {
  return (
    <div
      data-slot="muted-card"
      data-tone={tone}
      className={cn("rounded-xl border p-3", mutedToneClasses[tone], className)}
      {...props}
    />
  );
}

export { Section, SmallCard, MutedCard };
