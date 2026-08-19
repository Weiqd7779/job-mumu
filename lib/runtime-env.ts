import { env as workerEnv } from "cloudflare:workers";

type RuntimeValue = string | undefined;

export function readRuntimeEnv(name: string): RuntimeValue {
  const bound = (workerEnv as unknown as Record<string, unknown>)[name];
  if (typeof bound === "string" && bound.trim()) return bound.trim();

  const nodeValue =
    typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
  return nodeValue || undefined;
}

export function requireRuntimeEnv(name: string): string {
  const value = readRuntimeEnv(name);
  if (!value) throw new Error(`Missing server runtime value: ${name}`);
  return value;
}

export function csvRuntimeEnv(name: string): string[] {
  return (readRuntimeEnv(name) ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
