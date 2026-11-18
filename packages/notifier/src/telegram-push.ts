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

export interface TelegramFanoutResult {
  delivered: TelegramSendResult[];
  skippedUninitiated: { chatId: number; reason: string }[];
  failed: { chatId: number; reason: string }[];
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

export function isUninitiatedOrBlockedTelegramError(message: string): boolean {
  return /chat not found|bot was blocked|user is deactivated|can't initiate conversation|have no rights to send a message|Forbidden/i.test(
    message
  );
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

/**
 * Deduplicated multi-chat fan-out push (e.g. `[1479912341, 561860059]`).
 * Succeeds if at least one recipient receives the message, and gracefully skips
 * recipients who haven't pressed `/start` yet (`chat not found` / `403`) without failing.
 */
export async function sendTelegramPushFanout(params: {
  botToken: string;
  chatIds: number[];
  htmlText: string;
}): Promise<TelegramFanoutResult> {
  const uniqueChatIds = Array.from(
    new Set(params.chatIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))
  );

  if (uniqueChatIds.length === 0) {
    throw new Error("No valid Telegram chat IDs provided for fan-out push");
  }

  const settled = await Promise.allSettled(
    uniqueChatIds.map((chatId) =>
      sendTelegramPush({
        botToken: params.botToken,
        chatId,
        htmlText: params.htmlText,
      })
    )
  );

  const delivered: TelegramSendResult[] = [];
  const skippedUninitiated: { chatId: number; reason: string }[] = [];
  const failed: { chatId: number; reason: string }[] = [];

  settled.forEach((outcome, index) => {
    const chatId = uniqueChatIds[index];
    if (outcome.status === "fulfilled") {
      delivered.push(outcome.value);
      return;
    }

    const reason =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    if (isUninitiatedOrBlockedTelegramError(reason)) {
      skippedUninitiated.push({ chatId, reason });
      console.info(
        `[notifier] Chat ${chatId} is not initiated yet (${reason}); skipped cleanly.`
      );
    } else {
      failed.push({ chatId, reason });
      console.warn(`[notifier] Push failed for chat ${chatId}: ${reason}`);
    }
  });

  if (delivered.length === 0 && failed.length > 0) {
    throw new Error(failed.map((f) => `chat ${f.chatId}: ${f.reason}`).join("; "));
  }

  return { delivered, skippedUninitiated, failed };
}
