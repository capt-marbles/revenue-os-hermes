/**
 * Runtime abstraction for agent execution.
 *
 * The runtime defines how prompts get executed — which CLI, API, or SDK
 * handles the actual LLM call. The rest of the system (executor, sequences,
 * Co-Pilot, Telegram) calls through this interface without knowing whether
 * Claude, Hermes, or another runtime is doing the work.
 */

export interface RuntimeConfig {
  model: string;
  tools?: string[];
  mcpConfigPath?: string | null;
  maxTurns?: number;
  timeout?: number;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  /** Hermes profile name — when set, routes chat through a specific Hermes agent profile */
  profile?: string;
  /** AbortSignal — when aborted, the runtime should terminate the running process */
  signal?: AbortSignal;
}

export interface RuntimeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  tokensUsed?: number;
  costEstimate?: number;
}

export interface StreamCallbacks {
  onData: (chunk: string) => void;
  onError: (error: string) => void;
  onClose: (exitCode: number) => void;
}

export interface AgentRuntime {
  /** Unique identifier for this runtime */
  readonly id: string;

  /** Display name */
  readonly name: string;

  /**
   * Execute a prompt and wait for the complete response.
   * Used by: agent executor, goal decomposition, Telegram bot.
   */
  execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult>;

  /**
   * Execute a prompt with streaming output.
   * Used by: Co-Pilot chat (SSE streaming to browser).
   * If not supported, falls back to execute() and returns the full result at once.
   */
  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void;
}
