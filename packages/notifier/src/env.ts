import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function parseEnvFileIntoProcess(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadNotifierEnv() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../.env"),
    path.resolve(currentDir, "../../../.env"),
  ];

  for (const candidate of candidates) {
    parseEnvFileIntoProcess(candidate);
  }

  const EnvSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(10, "Missing TELEGRAM_BOT_TOKEN"),
    ALLOWED_TELEGRAM_USER_ID: z.coerce.number().int().positive().default(1479912341),
    NEXT_PUBLIC_APP_URL: z.string().default("https://life.vector-bd.top"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url("Missing NEXT_PUBLIC_SUPABASE_URL"),
    OWNER_EMAIL: z.string().email("Missing OWNER_EMAIL"),
    OWNER_PASSWORD: z.string().min(1, "Missing OWNER_PASSWORD"),
  });

  const parsed = EnvSchema.parse(process.env);
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    ownerTelegramId: parsed.ALLOWED_TELEGRAM_USER_ID,
    appUrl: parsed.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
  };
}
