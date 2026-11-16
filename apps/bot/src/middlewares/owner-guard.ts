import type { Context, NextFunction } from "grammy";
import { getOwnerBotDbClient, getOwnerProfile } from "@life-os/db";
import { botConfig } from "../config";

/**
 * Strictly restricts all bot interactions to the single owner (`ALLOWED_TELEGRAM_USER_ID`).
 * Supports both private 1:1 chat and the owner's private Forum Supergroup with Topics.
 */
export async function ownerGuardMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const fromId = ctx.from?.id;
  if (!fromId || fromId !== botConfig.allowedTelegramUserId) {
    // Silently drop updates from any stranger
    return;
  }

  const chat = ctx.chat;
  if (!chat) return;

  if (chat.type === "private") {
    await next();
    return;
  }

  // Allow supergroups/groups initiated by the owner: if a specific group ID is pinned,
  // verify it matches either env or user_profiles.telegram_forum_chat_id (unless binding).
  const text = ctx.msg?.text ?? "";
  if (text.startsWith("/bind_topic") || text.startsWith("/start")) {
    await next();
    return;
  }

  if (botConfig.allowedTelegramGroupId && chat.id === botConfig.allowedTelegramGroupId) {
    await next();
    return;
  }

  try {
    const { db } = await getOwnerBotDbClient();
    const profile = await getOwnerProfile(db);
    if (!profile?.telegram_forum_chat_id || profile.telegram_forum_chat_id === chat.id) {
      await next();
      return;
    }
  } catch (err) {
    console.error("[owner-guard] Failed to read profile forum group id:", err);
  }
}
