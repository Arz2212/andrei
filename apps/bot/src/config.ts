import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load local .env or root monorepo .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export const botConfig = {
  appUrl: (process.env.NEXT_PUBLIC_APP_URL || "https://life.vector-bd.top").trim(),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  allowedTelegramUserId: Number(requireEnv("ALLOWED_TELEGRAM_USER_ID")),
  allowedTelegramGroupId: process.env.ALLOWED_TELEGRAM_GROUP_ID
    ? Number(process.env.ALLOWED_TELEGRAM_GROUP_ID)
    : null,

  deepseekApiKey: requireEnv("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").trim(),
  deepseekModel: (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim(),

  polzaApiKey: (process.env.POLZA_API_KEY || "").trim(),
  polzaBaseUrl: (process.env.POLZA_BASE_URL || "https://api.polza.ai/api/v1").trim(),
  polzaSttModels: ["openai/whisper-large-v3-turbo", "ai-sage/gigaam-v3"] as const,
  polzaVisionFallbackModel: "qwen/qwen4-max",
};

export function resolveDeepSeekModelId(dbModelId: string | null | undefined): string {
  if (dbModelId && dbModelId.trim().toLowerCase().startsWith("deepseek-")) {
    return dbModelId.trim();
  }
  return botConfig.deepseekModel;
}
