export interface SendTelegramPushParams {
  botToken: string;
  chatId: number;
  htmlText: string;
  messageThreadId?: number | null;
}

export interface TelegramSendResult {
  ok: true;
  messageId: number;
  chatId: number;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
  result?: {
    message_id: number;
    chat?: { id: number };
  };
}

export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSendMessage(params: {
  botToken: string;
  chatId: number;
  text: string;
  parseMode?: "HTML";
  messageThreadId?: number | null;
}): Promise<{ status: number; payload: TelegramApiResponse }> {
  const endpoint = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    text: params.text,
    link_preview_options: { is_disabled: true },
  };
  if (params.parseMode) {
    body.parse_mode = params.parseMode;
  }
  if (params.messageThreadId && params.messageThreadId > 0) {
    body.message_thread_id = params.messageThreadId;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => ({
    ok: false,
    description: `Non-JSON response (HTTP ${response.status})`,
  }))) as TelegramApiResponse;

  return { status: response.status, payload };
}

/**
 * Pure HTTP push via Telegram Bot API `sendMessage`.
 * Zero long-polling, zero webhook mutation, zero conflict with external OpenClaw!
 */
export async function sendTelegramPush(
  params: SendTelegramPushParams
): Promise<TelegramSendResult> {
  const maxAttempts = 3;
  let lastError = "Unknown Telegram sendMessage error";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { status, payload } = await postSendMessage({
        botToken: params.botToken,
        chatId: params.chatId,
        text: params.htmlText,
        parseMode: "HTML",
        messageThreadId: params.messageThreadId,
      });

      if (payload.ok && payload.result) {
        return {
          ok: true,
          messageId: payload.result.message_id,
          chatId: payload.result.chat?.id ?? params.chatId,
        };
      }

      const description = payload.description ?? `HTTP ${status}`;
      lastError = `Telegram API error (${status}): ${description}`;

      // Entity parse error -> immediate plain-text fallback without losing the push!
      if (status === 400 && /can't parse entities|parse entities/i.test(description)) {
        const plainFallback = await postSendMessage({
          botToken: params.botToken,
          chatId: params.chatId,
          text: stripHtmlToPlainText(params.htmlText),
          messageThreadId: params.messageThreadId,
        });
        if (plainFallback.payload.ok && plainFallback.payload.result) {
          return {
            ok: true,
            messageId: plainFallback.payload.result.message_id,
            chatId: plainFallback.payload.result.chat?.id ?? params.chatId,
          };
        }
        lastError = `Plain fallback failed: ${plainFallback.payload.description ?? plainFallback.status}`;
      }

      if (status === 429 && payload.parameters?.retry_after) {
        const waitSec = Math.min(payload.parameters.retry_after, 30);
        await sleep(waitSec * 1000);
        continue;
      }

      // Non-retryable 4xx (other than 429)
      if (status >= 400 && status < 500) {
        throw new Error(lastError);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (/Telegram API error \(4\d\d\)/.test(lastError)) {
        throw err;
      }
    }

    if (attempt < maxAttempts) {
      await sleep(attempt * 1500);
    }
  }

  throw new Error(lastError);
}
