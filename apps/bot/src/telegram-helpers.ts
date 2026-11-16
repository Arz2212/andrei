import { InlineKeyboard, type Context } from "grammy";
import { botConfig } from "./config";

export type TopicDomain = "assistant" | "finance" | "nutrition" | "health" | "journal";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Converts lightweight Markdown produced by the LLM into safe Telegram HTML
 * so special characters never cause a 400 entity parse failure.
 */
export function markdownToTelegramHtml(md: string): string {
  let text = escapeHtml(md.trim());
  // Code blocks
  text = text.replace(/```([\s\S]*?)```/g, "<pre>$1</pre>");
  // Inline code
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Bold **text**
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  // Clean markdown headings ### Heading -> bold line
  text = text.replace(/^#{1,4}\s+(.+)$/gm, "<b>$1</b>");
  return text;
}

export function getThreadReplyParams(ctx: Context): { message_thread_id?: number } {
  const threadId = ctx.msg?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
  return typeof threadId === "number" ? { message_thread_id: threadId } : {};
}

export async function replyFormatted(
  ctx: Context,
  markdownText: string,
  keyboard?: InlineKeyboard
) {
  const threadParams = getThreadReplyParams(ctx);
  const html = markdownToTelegramHtml(markdownText);
  try {
    return await ctx.reply(html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
      ...threadParams,
    });
  } catch {
    return await ctx.reply(markdownText, {
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
      ...threadParams,
    });
  }
}

export function buildHitlKeyboard(actionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Подтвердить запись", `hitl:confirm:${actionId}`)
    .row()
    .text("✏️ Исправить", `hitl:edit:${actionId}`)
    .text("❌ Отмена", `hitl:cancel:${actionId}`);
}

export async function downloadTelegramFile(
  ctx: Context,
  fileId: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Не удалось получить путь к файлу в Telegram");
  }
  const url = `https://api.telegram.org/file/bot${botConfig.telegramBotToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ошибка скачивания файла из Telegram: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filePath: file.file_path,
  };
}

export function resolveTopicDomain(
  topicMapRaw: unknown,
  messageThreadId?: number
): TopicDomain {
  if (!messageThreadId || !topicMapRaw || typeof topicMapRaw !== "object") {
    return "assistant";
  }
  const map = topicMapRaw as Record<string, unknown>;
  const domains: TopicDomain[] = ["assistant", "finance", "nutrition", "health", "journal"];
  for (const domain of domains) {
    if (Number(map[domain]) === messageThreadId) {
      return domain;
    }
  }
  return "assistant";
}
