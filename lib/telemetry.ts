import { sha256Text } from "./ids";
import { readRuntimeEnv } from "./runtime-env";

export type RunTelemetry = {
  executionId: string;
  userEmail: string;
  projectId: string;
  taskType: string;
  agentSkill?: string;
  skillVersion?: string;
  status: string;
  stage: string;
  modelId?: string | null;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsdMicros?: number;
  fallbackUsed?: boolean;
  braveQueries?: number;
  braveResults?: number;
  sourceStatus?: Record<string, unknown>;
  qualityFlags?: string[];
};

export type RuntimeControls = {
  paidAnalysisPaused: boolean;
  disabledModels: string[];
  approvedFallbackModel: string;
  monthlyTotalCapMicros: number;
  fireworksCapMicros: number;
  braveCapMicros: number;
};

export async function readRuntimeControls(): Promise<RuntimeControls | null> {
  const endpoint = readRuntimeEnv("TELEMETRY_ENDPOINT");
  const token = readRuntimeEnv("TELEMETRY_WRITE_TOKEN");
  if (!endpoint || !token) return null;
  try {
    const response = await fetch(
      endpoint.replace(/\/telemetry\/?$/, "/controls/runtime"),
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_500),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as RuntimeControls;
  } catch {
    return null;
  }
}

/**
 * Sends only operational metadata to the separate developer console.
 * Failures are intentionally non-blocking: telemetry may never break a user run.
 */
export async function emitRunTelemetry(event: RunTelemetry): Promise<void> {
  const endpoint = readRuntimeEnv("TELEMETRY_ENDPOINT");
  const token = readRuntimeEnv("TELEMETRY_WRITE_TOKEN");
  if (!endpoint || !token) return;

  try {
    const userHash = await sha256Text(
      `${event.userEmail.toLowerCase()}:${token.slice(0, 16)}`,
    );
    await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        executionId: event.executionId,
        userHash,
        projectId: event.projectId,
        taskType: event.taskType,
        agentSkill: event.agentSkill ?? "career-analysis",
        skillVersion: event.skillVersion ?? "unknown",
        modelId: event.modelId ?? null,
        status: event.status,
        stage: event.stage,
        latencyMs: event.latencyMs ?? 0,
        inputTokens: event.inputTokens ?? 0,
        outputTokens: event.outputTokens ?? 0,
        costUsdMicros: event.costUsdMicros ?? 0,
        fallbackUsed: event.fallbackUsed ?? false,
        braveQueries: event.braveQueries ?? 0,
        braveResults: event.braveResults ?? 0,
        sourceStatus: event.sourceStatus ?? {},
        qualityFlags: event.qualityFlags ?? [],
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3_500),
    });
  } catch {
    // Telemetry is best-effort and carries no user content.
  }
}
