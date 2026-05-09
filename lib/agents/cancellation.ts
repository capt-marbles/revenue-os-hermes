const controllers = new Map<string, AbortController>();

export function registerRun(runId: string): AbortController {
  const controller = new AbortController();
  controllers.set(runId, controller);
  return controller;
}

export function cancelRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(runId);
  return true;
}

export function unregisterRun(runId: string): void {
  controllers.delete(runId);
}
