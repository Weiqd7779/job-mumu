import { redirect } from "next/navigation";
import {
  chatGPTSignInPath,
  getChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import { csvRuntimeEnv, readRuntimeEnv } from "./runtime-env";

export type AppUser = ChatGPTUser & { isDeveloperPreview: boolean };

export async function getAppUser(): Promise<AppUser | null> {
  const authenticated = await getChatGPTUser();
  if (authenticated) {
    return { ...authenticated, isDeveloperPreview: false };
  }

  const environment = readRuntimeEnv("APP_ENVIRONMENT") ?? "development";
  const devEmail = readRuntimeEnv("DEV_USER_EMAIL");
  if (environment !== "production" && devEmail) {
    return {
      email: devEmail.toLowerCase(),
      displayName: "本機預覽使用者",
      fullName: "本機預覽使用者",
      isDeveloperPreview: true,
    };
  }

  return null;
}

export function isAllowedUser(email: string): boolean {
  const allowlist = csvRuntimeEnv("ALLOWED_USER_EMAILS");
  if (!allowlist.length) {
    return (readRuntimeEnv("APP_ENVIRONMENT") ?? "development") !== "production";
  }
  return allowlist.includes(email.trim().toLowerCase());
}

export async function requirePageUser(returnTo: string): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) redirect(chatGPTSignInPath(returnTo));
  return user;
}

export async function requireApiUser(): Promise<
  | { ok: true; user: AppUser }
  | { ok: false; response: Response }
> {
  const user = await getAppUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "authentication_required" }, { status: 401 }),
    };
  }
  if (!isAllowedUser(user.email)) {
    return {
      ok: false,
      response: Response.json({ error: "invite_required" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
