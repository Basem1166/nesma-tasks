import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { prisma } from "../db.js";
import type { AuthUser } from "../domain.js";
import { HttpError } from "../lib/http.js";
import {
  AI_MODEL,
  aiProvider,
  describeAiError,
  FALLBACK_BETA,
  getClient,
  getOpenAIClient,
  isAiConfigured,
  type AiProvider,
} from "./client.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

type ClaudeMessage = Anthropic.Beta.BetaMessageParam;
type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

const MAX_TOOL_ROUNDS = 8;

// Stable instructions first so the prefix (tools + this block) is cacheable.
const SYSTEM_INSTRUCTIONS = `You are Nesma Assistant, the AI helper inside a team task-management platform. You answer questions about the team's tasks, analyse progress and write summaries.

How to work:
- Always ground answers in data from the tools. Never guess task names, people, dates or numbers. If the tools return nothing relevant, say so.
- Call several tools in parallel when they are independent.
- The user can only see a subset of data (described below). Tools already enforce this; do not speculate about data outside it.
- Dates from tools are UTC ISO strings. Present them in a friendly form (e.g. "Tue 4 Nov").
- Be concise. Use short paragraphs, bullet lists and small Markdown tables where they help. Bold key figures.
- When summarising, cover: what is done, what is in progress, what is at risk (overdue / due soon with low progress), and suggested next steps.
- You are read-only: you cannot create or modify tasks. If asked to, explain how to do it in the app.`;

function userContext(user: AuthUser) {
  const today = new Date().toISOString().slice(0, 10);
  const scope =
    user.role === "LEADER"
      ? "They are a TEAM LEADER and can see every task in their team."
      : "They are a TEAM MEMBER and can only see tasks assigned to them or created by them.";
  return `Signed-in user: ${user.name} (${user.email}). ${scope}\nToday's date (UTC): ${today}.`;
}

/** One stored transcript entry: the provider-native message, exactly as exchanged. */
interface StoredTurn {
  role: string;
  content: unknown;
}

interface TurnResult {
  turn: StoredTurn[];
  finalText: string;
  toolsUsed: string[];
  model: string;
}

// ---------------------------------------------------------------------------
// Claude (Anthropic Messages API)
// ---------------------------------------------------------------------------

async function runClaudeTurn(user: AuthUser, history: StoredTurn[], text: string): Promise<TurnResult> {
  const prior = history.map((h) => ({ role: h.role, content: h.content }) as ClaudeMessage);
  const turn: ClaudeMessage[] = [{ role: "user", content: [{ type: "text", text }] }];
  const toolsUsed: string[] = [];
  let model = AI_MODEL();

  for (let round = 0; ; round++) {
    const response = await getClient().beta.messages.create({
      model: AI_MODEL(),
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: [
        { type: "text", text: SYSTEM_INSTRUCTIONS },
        { type: "text", text: userContext(user) },
      ],
      tools: TOOL_DEFINITIONS,
      // After the last allowed tool round the model must answer from what it has.
      tool_choice: round >= MAX_TOOL_ROUNDS ? { type: "none" } : { type: "auto" },
      messages: [...prior, ...turn],
    });
    model = response.model;

    if (response.stop_reason === "refusal") throw new HttpError(422, "The assistant declined to answer that request.");
    if (response.stop_reason === "max_tokens") throw new HttpError(502, "The assistant's answer was too long. Try a narrower question.");

    turn.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      const finalText = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { turn: turn as StoredTurn[], finalText, toolsUsed, model };
    }

    // Execute independent tool calls concurrently; all results go back in ONE user message.
    const results = await Promise.all(
      calls.map(async (call) => {
        toolsUsed.push(call.name);
        const r = await executeTool(user, call.name, call.input);
        return { type: "tool_result" as const, tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }),
    );
    turn.push({ role: "user", content: results });
  }
}

// ---------------------------------------------------------------------------
// Gemini / any OpenAI-compatible Chat Completions API
// ---------------------------------------------------------------------------

const OPENAI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
}));

async function runOpenAITurn(user: AuthUser, history: StoredTurn[], text: string): Promise<TurnResult> {
  const system: ChatMessage = { role: "system", content: `${SYSTEM_INSTRUCTIONS}\n\n${userContext(user)}` };
  const prior = history.map((h) => h.content as ChatMessage);
  const turn: ChatMessage[] = [{ role: "user", content: text }];
  const toolsUsed: string[] = [];
  let model = AI_MODEL();

  for (let round = 0; ; round++) {
    const response = await getOpenAIClient().chat.completions.create({
      model: AI_MODEL(),
      messages: [system, ...prior, ...turn],
      tools: OPENAI_TOOLS,
      tool_choice: round >= MAX_TOOL_ROUNDS ? "none" : "auto",
    });
    model = response.model || model;
    const choice = response.choices[0];
    if (!choice) throw new HttpError(502, "The AI service returned no answer.");
    const msg = choice.message;
    // Store the message exactly as returned: some providers (e.g. Gemini) attach
    // signatures to tool calls that must be sent back unchanged.
    turn.push(msg as ChatMessage);

    const calls = (msg.tool_calls ?? []).filter(
      (c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
    if (calls.length === 0) {
      if (choice.finish_reason === "length") throw new HttpError(502, "The assistant's answer was too long. Try a narrower question.");
      return { turn: turn.map((m) => ({ role: m.role, content: m })), finalText: (msg.content ?? "").trim(), toolsUsed, model };
    }

    const results = await Promise.all(
      calls.map(async (call): Promise<ChatMessage> => {
        toolsUsed.push(call.function.name);
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          return { role: "tool", tool_call_id: call.id, content: "Error: tool arguments were not valid JSON." };
        }
        const r = await executeTool(user, call.function.name, input);
        return { role: "tool", tool_call_id: call.id, content: r.isError ? `Error: ${r.content}` : r.content };
      }),
    );
    turn.push(...results);
  }
}

// ---------------------------------------------------------------------------
// Shared conversation handling
// ---------------------------------------------------------------------------

export interface ChatResult {
  conversationId: string;
  reply: string;
  toolsUsed: string[];
  model: string;
}

/**
 * One user turn: runs the provider's tool-use loop, then appends the whole
 * exchange (user text, tool calls, tool results, final answer) to the
 * conversation exactly as exchanged. If anything fails midway, nothing is
 * stored, so the persisted history always stays a valid, append-only transcript.
 */
export async function chat(user: AuthUser, text: string, conversationId?: string): Promise<ChatResult> {
  if (!isAiConfigured()) {
    throw new HttpError(503, "AI is not configured on this server. Set AI_API_KEY (free Gemini key) in server/.env and restart.");
  }
  const provider: AiProvider = aiProvider();

  let conversation = conversationId
    ? await prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id } })
    : null;
  if (conversationId && !conversation) throw new HttpError(404, "Conversation not found");
  if (conversation && conversation.provider !== provider) {
    throw new HttpError(409, "This conversation was started with a different AI provider. Start a new chat.");
  }

  const rows = conversation
    ? await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { seq: "asc" } })
    : [];
  const history: StoredTurn[] = rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
  const nextSeq = rows.length ? rows[rows.length - 1]!.seq + 1 : 0;

  let result: TurnResult;
  try {
    result = provider === "anthropic" ? await runClaudeTurn(user, history, text) : await runOpenAITurn(user, history, text);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("[ai] chat failed:", e);
    throw new HttpError(502, describeAiError(e));
  }
  const finalText = result.finalText || "I couldn't produce an answer for that. Please try rephrasing.";

  conversation ??= await prisma.aiConversation.create({
    data: { userId: user.id, provider, title: text.length > 60 ? `${text.slice(0, 57)}...` : text },
  });
  const convId = conversation.id;
  const lastIndex = result.turn.length - 1;
  await prisma.$transaction([
    ...result.turn.map((m, i) =>
      prisma.aiMessage.create({
        data: {
          conversationId: convId,
          seq: nextSeq + i,
          role: m.role,
          content: JSON.stringify(m.content),
          displayText: i === 0 ? text : i === lastIndex ? finalText : null,
        },
      }),
    ),
    prisma.aiConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } }),
  ]);

  return { conversationId: convId, reply: finalText, toolsUsed: [...new Set(result.toolsUsed)], model: result.model };
}

/** Tool names requested by one stored assistant message, for either provider format. */
function toolNames(content: unknown): string[] {
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === "tool_use" && b.name).map((b) => b.name as string);
  }
  const calls = (content as { tool_calls?: { function?: { name?: string } }[] } | null)?.tool_calls ?? [];
  return calls.map((c) => c.function?.name).filter((n): n is string => !!n);
}

/** Visible transcript for the UI: user questions and final answers, with the tools used for each answer. */
export async function transcript(userId: string, conversationId: string) {
  const conv = await prisma.aiConversation.findFirst({ where: { id: conversationId, userId } });
  if (!conv) throw new HttpError(404, "Conversation not found");
  const rows = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { seq: "asc" } });
  const out: { id: string; role: string; text: string; toolsUsed: string[]; createdAt: Date }[] = [];
  let pendingTools: string[] = [];
  for (const r of rows) {
    if (r.role === "assistant") pendingTools.push(...toolNames(JSON.parse(r.content)));
    if (r.displayText !== null) {
      out.push({
        id: r.id,
        role: r.role,
        text: r.displayText,
        toolsUsed: r.role === "assistant" ? [...new Set(pendingTools)] : [],
        createdAt: r.createdAt,
      });
      if (r.role === "assistant") pendingTools = [];
    }
  }
  return { id: conv.id, title: conv.title, provider: conv.provider, messages: out };
}
