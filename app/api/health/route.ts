import { readRuntimeEnv } from "@/lib/runtime-env";

export async function GET() {
  return Response.json({
    status: "ok",
    app: "job-mumu",
    services: {
      fireworks: Boolean(readRuntimeEnv("FIREWORKS_API_KEY")),
      brave: Boolean(readRuntimeEnv("BRAVE_SEARCH_API_KEY")),
      telemetry: Boolean(readRuntimeEnv("TELEMETRY_WRITE_TOKEN")),
    },
    checkedAt: new Date().toISOString(),
  });
}
