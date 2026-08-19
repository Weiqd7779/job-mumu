declare module "cloudflare:workers" {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    APP_ENVIRONMENT?: string;
    DEV_USER_EMAIL?: string;
    ALLOWED_USER_EMAILS?: string;
    FIREWORKS_API_KEY?: string;
    FIREWORKS_ANALYSIS_MODEL?: string;
    BRAVE_SEARCH_API_KEY?: string;
    TELEMETRY_ENDPOINT?: string;
    TELEMETRY_WRITE_TOKEN?: string;
  }
}
