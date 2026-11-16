#!/usr/bin/env node

// Redirect any accidental console.log calls to stderr BEFORE importing anything
// so stdout stays 100% clean for MCP JSON-RPC 2.0 frames.
console.log = (...args: unknown[]) => {
  console.error(...args);
};

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAssistantFullContext, getOwnerBotDbClient } from "@life-os/db";
import { loadEnvSilently } from "./helpers";
import { registerOverviewAndTaskTools } from "./tools/tasks";
import { registerJournalAndStateTools } from "./tools/journal";
import { registerStage2To4DomainTools } from "./tools/roadmap-domains";

loadEnvSilently();

const server = new McpServer({
  name: "life-os",
  version: "1.0.0",
});

registerOverviewAndTaskTools(server);
registerJournalAndStateTools(server);
registerStage2To4DomainTools(server);

// Expose live assistant persona & agreements as an MCP prompt as well
server.registerPrompt(
  "life-os-partner",
  {
    title: "Личность бизнес-ассистента Life OS («Напарник»)",
    description:
      "Подгружает актуальный системный промпт личности, тон общения и личные договорённости пользователя напрямую из базы Supabase.",
  },
  async () => {
    const { db } = await getOwnerBotDbClient();
    const ctx = await getAssistantFullContext(db);
    const agreementsBlock =
      ctx.agreements.length > 0
        ? ctx.agreements.map((a) => `- [${a.scope}] ${a.rule_text}`).join("\n")
        : "- Нет дополнительных правил.";

    const text = [
      ctx.settings?.system_prompt ??
        "Ты — личный бизнес-ассистент и операционный напарник в системе Life OS.",
      "",
      `Тон общения: ${ctx.settings?.tone_guidelines ?? "На «ты», живо, по делу, без стены текста."}`,
      "",
      "Активные личные договорённости пользователя:",
      agreementsBlock,
    ].join("\n");

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text,
          },
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[life-os-mcp] Connected over stdio and ready.");
}

main().catch((err) => {
  console.error("[life-os-mcp] Fatal startup error:", err);
  process.exit(1);
});
