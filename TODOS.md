# TODOS

## Completed

### ~~Auth middleware for dangerous routes~~ (DONE 2026-04-05)
- `lib/auth.ts` — `requireAuth()` helper checking Bearer header or ?token= query param
- Applied to all 22 mutation routes (POST/PATCH/DELETE)
- Hardcoded token removed from `app/settings/page.tsx`
- Replaced inline token checks in scheduler/trigger and telegram routes

### ~~Zod schemas for PATCH endpoints~~ (DONE 2026-04-05)
- `lib/schemas.ts` — 6 partial Zod schemas (agent, task, goal, schedule, memory, connector)
- Applied to all 6 PATCH endpoints, replacing raw `...body` spreads with validated `...parsed.data`

## Deferred

### Shared-use hardening (P1)
- What: Harden the app for shared use beyond the primary operator, including tenant isolation, auth boundaries, connector permission model, and safe multi-user rollout.
- Why: The current product is becoming important enough to trust daily. If it later expands to more users without these boundaries, the first success will create the next failure.
- Pros: Preserves the path from single-operator tool to broader internal product without a trust or security reset.
- Cons: Adds auth, permissions, and tenancy complexity before it directly improves the core daily command loop.
- Context: Current scope intentionally optimizes for one Head of Growth first. This item should be completed before promoting the product to broader internal usage or shared connector access.
- Effort estimate: L human / M with CC+gstack
- Priority: P1
- Depends on / blocked by: Depends on the Command Center and Opportunity model settling first so the hardening targets the real product shape.
