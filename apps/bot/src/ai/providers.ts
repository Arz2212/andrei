import { createOpenAI } from "@ai-sdk/openai";
import { botConfig, resolveDeepSeekModelId } from "../config";

export const deepseekProvider = createOpenAI({
  name: "deepseek",
  baseURL: botConfig.deepseekBaseUrl,
  apiKey: botConfig.deepseekApiKey,
});

export const polzaProvider = createOpenAI({
  name: "polza",
  baseURL: botConfig.polzaBaseUrl,
  apiKey: botConfig.polzaApiKey || "missing-polza-key",
});

export function getPrimaryChatModel(dbModelId?: string | null) {
  return deepseekProvider.chat(resolveDeepSeekModelId(dbModelId));
}

export function getPolzaVisionFallbackModel() {
  return polzaProvider.chat(botConfig.polzaVisionFallbackModel);
}
