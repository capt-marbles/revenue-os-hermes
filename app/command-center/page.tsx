import { PageShell } from "@/components/layout/page-shell";
import { assembleCommandCenter } from "@/lib/command-center/assemble";
import { ensureDailyBriefingSnapshot } from "@/lib/command-center/briefing";
import { OpportunityQueue } from "@/components/command-center/opportunity-queue";
import { PipelineFunnel } from "@/components/command-center/pipeline-funnel";
import { Section, SmallCard, MutedCard } from "@/components/ui/section";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { cn } from "@/lib/utils";

type Tone = "default" | "warning" | "success";

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning/10 text-warning"
      : tone === "success"
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <SmallCard>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </SmallCard>
  );
}

export default async function CommandCenterPage() {
  ensureDailyBriefingSnapshot();
  const [data, agentRows] = await Promise.all([
    assembleCommandCenter(),
    Promise.resolve(
      db.select().from(agents).where(eq(agents.tenantId, getTenantId())).all(),
    ),
  ]);

  const drafted = data.queue.items.filter(
    (i) => i.draftStatus === "generated" || i.draftStatus === "approved",
  ).length;
  const synced = data.queue.items.filter((i) => i.syncStatus === "success").length;
  const needsAction = data.queue.items.filter(
    (i) =>
      i.status === "queued" || i.status === "scored" || i.status === "discovered",
  ).length;

  return (
    <PageShell
      title="Command Center"
      description="Pipeline, queue, and daily briefing"
      actions={
        <Badge tone={data.sourceHealth.length > 0 ? "warning" : "success"}>
          {data.briefing.freshnessLabel}
        </Badge>
      }
    >
      <div className="space-y-6 p-6">
        {/* Metric strip */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="Queued"
            value={data.queue.availableCount}
            sub={`of ${data.queue.targetCount} target`}
            tone={
              data.queue.availableCount >= data.queue.targetCount
                ? "success"
                : "default"
            }
          />
          <MetricCard
            label="Needs Action"
            value={needsAction}
            tone={needsAction > 0 ? "warning" : "success"}
          />
          <MetricCard label="Drafted" value={drafted} />
          <MetricCard label="Synced" value={synced} />
          <MetricCard
            label="Source Health"
            value={
              data.sourceHealth.length === 0
                ? "OK"
                : `${data.sourceHealth.length} issues`
            }
            tone={data.sourceHealth.length === 0 ? "success" : "warning"}
          />
        </section>

        {/* Two-column: Briefing + Funnel */}
        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
          {/* Briefing */}
          <details
            open
            className="rounded-2xl border border-border bg-card"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 select-none">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Daily Briefing
                </p>
                <h2 className="mt-1 text-lg font-semibold">What matters today</h2>
              </div>
              <Badge
                tone={data.briefing.status === "partial" ? "warning" : "success"}
              >
                {data.queue.availableCount}/{data.queue.targetCount} queued
              </Badge>
            </summary>
            <div className="border-t border-border px-5 pb-5 pt-3">
              <div className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {data.briefing.summaryMarkdown.replace(/^##\s.+\n?/m, "").trim()}
              </div>
              {data.briefing.shortfallReason && (
                <MutedCard tone="warning" className="mt-4 text-sm text-warning">
                  {data.briefing.shortfallReason}
                </MutedCard>
              )}
              {data.controls.sourceMix.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.controls.sourceMix.map((source) => (
                    <Badge key={source.sourceType}>
                      {source.label}: {source.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Funnel */}
          <Section>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pipeline Funnel
            </p>
            <h2 className="mt-1 text-base font-semibold">Stage distribution</h2>
            <div className="mt-4">
              <PipelineFunnel />
            </div>
          </Section>
        </section>

        {/* Source health alerts */}
        {data.sourceHealth.length > 0 && (
          <Section tone="warning">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning">
                  Feed Health
                </p>
                <h2 className="mt-1 text-base font-semibold text-warning">
                  {data.sourceHealth.length} source
                  {data.sourceHealth.length === 1 ? "" : "s"} need attention
                </h2>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.sourceHealth.map((item) => (
                <MutedCard key={item.id} tone="warning" className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{item.name}</p>
                    <Badge tone="warning">{item.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.note}</p>
                </MutedCard>
              ))}
            </div>
          </Section>
        )}

        {/* Opportunity queue */}
        <Section className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-4 border-b border-border p-5 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Opportunity Queue
              </p>
              <h2 className="mt-1 text-base font-semibold">
                {data.queue.availableCount} opportunit
                {data.queue.availableCount === 1 ? "y" : "ies"} ranked by score
              </h2>
            </div>
          </div>
          <div className="p-5 pt-3">
            <OpportunityQueue initialItems={data.queue.items} />
          </div>
        </Section>

        {/* Agents */}
        {agentRows.length > 0 && (
          <Section>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Agents
                </p>
                <h2 className="mt-1 text-base font-semibold">
                  {agentRows.length} agent{agentRows.length === 1 ? "" : "s"}
                </h2>
              </div>
              <Badge
                tone={
                  agentRows.some((a) => a.status === "running")
                    ? "success"
                    : "default"
                }
              >
                {agentRows.filter((a) => a.status === "running").length} running
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {agentRows.map((agent) => (
                <a
                  key={agent.id}
                  href={`/agents`}
                  className="group flex flex-col gap-1 rounded-xl border border-border bg-background/50 p-3 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        agent.status === "running"
                          ? "bg-success"
                          : "bg-muted-foreground/30",
                      )}
                    />
                  </div>
                  {agent.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {agent.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    {agent.agentType?.replace("_", " ") ?? "specialist"}
                  </p>
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* Learning */}
        <Section>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Learning
              </p>
              <h2 className="mt-1 text-base font-semibold">Outreach performance</h2>
            </div>
            <Badge>{data.learning.sampleQualified ? "Qualified" : "Suppressed"}</Badge>
          </div>

          {data.learning.sampleQualified ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {data.learning.insightCards.map((card) => (
                <MutedCard key={card.title} className="p-4">
                  <p className="text-sm font-medium">{card.title}</p>
                  <p className="mt-2 text-xl font-semibold">{card.metric}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{card.detail}</p>
                </MutedCard>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              {data.learning.suppressedReason}
            </div>
          )}
        </Section>
      </div>
    </PageShell>
  );
}
