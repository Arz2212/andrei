import { botConfig } from "../config";

export interface TranscriptionResult {
  text: string;
  provider: "deepseek" | "polza";
  model: string;
}

/**
 * Audio transcription pipeline per user rules:
 * 1. Attempt DeepSeek native audio understanding first.
 * 2. Because DeepSeek's current endpoint supports ["text", "image"] and rejects raw audio,
 *    automatically fall back to Polza.ai STT (`/audio/transcriptions`) ONLY when DeepSeek fails.
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  fileName = "voice.ogg",
  mimeType = "audio/ogg"
): Promise<TranscriptionResult> {
  // Step 1: Try DeepSeek multimodal audio input first
  try {
    const format = fileName.endsWith(".mp3")
      ? "mp3"
      : fileName.endsWith(".wav")
        ? "wav"
        : "ogg";
    const dsResponse = await fetch(`${botConfig.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botConfig.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: botConfig.deepseekModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Расшифруй голосовое сообщение дословно на русском языке без комментариев.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: audioBuffer.toString("base64"),
                  format,
                },
              },
            ],
          },
        ],
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (dsResponse.ok) {
      const dsJson = (await dsResponse.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const transcript = dsJson.choices?.[0]?.message?.content?.trim();
      if (transcript) {
        return {
          text: transcript,
          provider: "deepseek",
          model: botConfig.deepseekModel,
        };
      }
    } else {
      const errText = await dsResponse.text().catch(() => "");
      console.info(
        `[audio] DeepSeek audio unsupported/rejected (HTTP ${dsResponse.status}: ${errText.slice(0, 120)}), falling back to Polza.ai STT.`
      );
    }
  } catch (dsErr) {
    console.info(
      `[audio] DeepSeek audio attempt failed (${(dsErr as Error).message}), falling back to Polza.ai STT.`
    );
  }

  // Step 2: Polza.ai STT fallback (Whisper Large v3 Turbo -> GigaAM v3)
  if (!botConfig.polzaApiKey) {
    throw new Error("DeepSeek не поддерживает аудио, а POLZA_API_KEY не задан.");
  }

  let lastError = "Unknown STT error";
  for (const model of botConfig.polzaSttModels) {
    try {
      const formData = new FormData();
      const uint8 = new Uint8Array(audioBuffer);
      formData.append("file", new Blob([uint8], { type: mimeType }), fileName);
      formData.append("model", model);
      formData.append("language", "ru");

      const response = await fetch(`${botConfig.polzaBaseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botConfig.polzaApiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(35_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastError = `Polza STT (${model}) HTTP ${response.status}: ${body.slice(0, 200)}`;
        continue;
      }

      const json = (await response.json()) as { text?: string };
      const text = (json.text ?? "").trim();
      return {
        text,
        provider: "polza",
        model,
      };
    } catch (err) {
      lastError = `Polza STT (${model}) exception: ${(err as Error).message}`;
    }
  }

  throw new Error(`Не удалось распознать аудио: ${lastError}`);
}
