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
 * Splits overly dense paragraphs (>260 chars with 3+ sentences and no line breaks)
 * into airy 2-sentence visual blocks so Telegram messages never look like a wall of text.
 */
function ensureAiryParagraphs(text: string): string {
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Leave lists, code blocks, headers, and short blocks untouched
    if (
      trimmed.includes("\n") ||
      trimmed.length <= 260 ||
      trimmed.startsWith("<pre>") ||
      trimmed.startsWith("<blockquote>") ||
      trimmed.startsWith("• ")
    ) {
      out.push(trimmed);
      continue;
    }

    const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    if (!sentences || sentences.length <= 2) {
      out.push(trimmed);
      continue;
    }

    for (let i = 0; i < sentences.length; i += 2) {
      const chunk = sentences
        .slice(i, i + 2)
        .join(" ")
        .trim();
      if (chunk) out.push(chunk);
    }
  }

  return out.join("\n\n");
}

/**
 * Converts Markdown produced by the LLM into clean, structured Telegram HTML
 * (`<b>`, `<i>`, `<code>`, `<pre>`, `<blockquote>`, `•` bullets) without entity parse errors.
 */
export function markdownToTelegramHtml(md: string): string {
  const codeBlocks: string[] = [];
  let working = md.trim().replace(/\r\n/g, "\n");

  // 1. Protect fenced code blocks before escaping
  working = working.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_m, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `@@CODEBLOCK_${idx}@@`;
  });

  // 2. Escape raw HTML characters
  working = escapeHtml(working);

  // 3. Convert consecutive "> ..." lines into Telegram <blockquote>
  working = working.replace(/(?:^&gt;\s?.+(?:\n|$))+/gm, (quoteBlock) => {
    const inner = quoteBlock
      .trim()
      .split("\n")
      .map((line) => line.replace(/^&gt;\s?/, ""))
      .join("\n");
    return `<blockquote>${inner}</blockquote>\n`;
  });

  // 4. Inline code `...`
  working = working.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // 5. Markdown headings ### Title -> bold visual header
  working = working.replace(/^#{1,4}\s+(.+)$/gm, "<b>$1</b>");

  // 6. Bold **text** and __text__
  working = working.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  working = working.replace(/__([^_\n]+)__/g, "<b>$1</b>");

  // 7. Italic *text* (single asterisk not inside words/tags)
  working = working.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/gm, "$1<i>$2</i>");

  // 8. Normalize unordered bullets `- item` / `* item` -> `• item`
  working = working.replace(/^[ \t]*[-*]\s+/gm, "• ");

  // 9. Normalize spacing & break dense walls of text
  working = working.replace(/\n{3,}/g, "\n\n");
  working = ensureAiryParagraphs(working);

  // 10. Restore protected code blocks
  working = working.replace(/@@CODEBLOCK_(\d+)@@/g, (_m, i: string) => codeBlocks[Number(i)] ?? "");

  return working.trim();
}

export function stripHtmlTagsForFallback(html: string): string {
  return html
    .replace(/<\/?(?:b|i|code|pre|blockquote)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
    return await ctx.reply(stripHtmlTagsForFallback(html), {
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
