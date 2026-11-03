import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat } from "../src/ai/chatbot.js";
import { setClientForTests, setOpenAIClientForTests } from "../src/ai/client.js";
import { executeTool } from "../src/ai/tools.js";
import { prisma } from "../src/db.js";
import { api, asAuth, login, makeTeam, resetDb } from "./helpers.js";

describe("AI chatbot", () => {
  let team: Awaited<ReturnType<typeof makeTeam>>;
  let aliceTaskId: string;
  let bobTaskId: string;

  beforeEach(async () => {
    await resetDb();
    team = await makeTeam();
    const base = { teamId: team.team.id, createdById: team.leader.id };
    aliceTaskId = (await prisma.task.create({ data: { ...base, title: "Alice's audit", assigneeId: team.alice.id, priority: "URGENT", dueDate: new Date(Date.now() - 86_400_000) } })).id;
    bobTaskId = (await prisma.task.create({ data: { ...base, title: "Bob's secret project", assigneeId: team.bob.id } })).id;
  });

  afterEach(() => setClientForTests(null));

  describe("tools enforce the same access rules as the API", () => {
    it("members only find their own tasks", async () => {
      const r = await executeTool(asAuth(team.alice), "search_tasks", {});
      const out = JSON.parse(r.content);
      expect(out.total_matches).toBe(1);
      expect(out.tasks[0].title).toBe("Alice's audit");
    });

    it("members cannot open someone else's task", async () => {
      const r = await executeTool(asAuth(team.alice), "get_task", { task_id: bobTaskId });
      expect(JSON.parse(r.content).error).toMatch(/not found/i);
    });

    it("leaders see the whole team and can filter by assignee name and overdue", async () => {
      const all = JSON.parse((await executeTool(asAuth(team.leader), "search_tasks", {})).content);
      expect(all.total_matches).toBe(2);
      const overdue = JSON.parse((await executeTool(asAuth(team.leader), "search_tasks", { assignee: "alice", overdue_only: true })).content);
      expect(overdue.tasks.map((t: { title: string }) => t.title)).toEqual(["Alice's audit"]);
    });

    it("rejects invalid tool input as an error result", async () => {
      const r = await executeTool(asAuth(team.leader), "search_tasks", { status: ["BOGUS"] });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/Invalid input/);
      expect((await executeTool(asAuth(team.leader), "drop_tables", {})).isError).toBe(true);
    });
  });

  it("runs the tool loop against Claude and persists an append-only transcript", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: "claude-opus-5-5",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_1", name: "search_tasks", input: { overdue_only: true } },
        ],
      })
      .mockResolvedValueOnce({
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "You have **1 overdue task**: Alice's audit." }],
      });
    setClientForTests({ beta: { messages: { create } } } as unknown as Anthropic);

    const result = await chat(asAuth(team.alice), "What is overdue?");
    expect(result.reply).toContain("1 overdue task");
    expect(result.toolsUsed).toEqual(["search_tasks"]);

    // Second request carried the tool result computed from real (scoped) data.
    const secondCall = create.mock.calls[1]![0];
    expect(secondCall.model).toBe("claude-opus-5-5");
    expect(secondCall.fallbacks).toBe("default");
    const toolResultMsg = secondCall.messages.at(-1);
    expect(toolResultMsg.role).toBe("user");
    expect(toolResultMsg.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(toolResultMsg.content[0].content).toContain("Alice's audit");
    expect(toolResultMsg.content[0].content).not.toContain("Bob's secret project");

    const rows = await prisma.aiMessage.findMany({ where: { conversationId: result.conversationId }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);

    // A follow-up replays the stored history unchanged before the new question.
    create.mockResolvedValueOnce({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Sure." }] });
    await chat(asAuth(team.alice), "Thanks", result.conversationId);
    const third = create.mock.calls[2]![0];
    expect(third.messages).toHaveLength(5);
    expect(third.messages[1].content[1]).toMatchObject({ type: "tool_use", id: "toolu_1" });

    const { token } = await login("alice@test.dev");
    const t = await api(token).get(`/api/ai/conversations/${result.conversationId}`);
    expect(t.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "What is overdue?",
      "You have **1 overdue task**: Alice's audit.",
      "Thanks",
      "Sure.",
    ]);
    expect(t.body.messages[1].toolsUsed).toEqual(["search_tasks"]);
  });

  it("runs the same tool loop on the free Gemini (OpenAI-compatible) provider", async () => {
    const { config } = await import("../src/config.js");
    const saved = { p: config.AI_PROVIDER, k: config.AI_API_KEY };
    config.AI_PROVIDER = "gemini";
    config.AI_API_KEY = "test-gemini-key";
    try {
      const create = vi
        .fn()
        .mockResolvedValueOnce({
          model: "gemini-3.5-flash-lite",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "search_tasks", arguments: '{"overdue_only":true}' },
                    // Provider-specific extras must survive the round trip.
                    extra_content: { google: { thought_signature: "sig-abc" } },
                  },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          model: "gemini-3.5-flash-lite",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "One overdue task: Alice's audit." } }],
        });
      setOpenAIClientForTests({ chat: { completions: { create } } } as unknown as OpenAI);

      const r = await chat(asAuth(team.alice), "What is overdue?");
      expect(r.reply).toBe("One overdue task: Alice's audit.");
      expect(r.toolsUsed).toEqual(["search_tasks"]);

      const second = create.mock.calls[1]![0];
      expect(second.model).toBe("gemini-3.5-flash-lite");
      expect(second.tools[0].function.name).toBe("search_tasks");
      const [sys, user, assistant, tool] = second.messages;
      expect(sys.role).toBe("system");
      expect(sys.content).toContain("TEAM MEMBER");
      expect(user).toEqual({ role: "user", content: "What is overdue?" });
      expect(assistant.tool_calls[0].extra_content.google.thought_signature).toBe("sig-abc");
      expect(tool).toMatchObject({ role: "tool", tool_call_id: "call_1" });
      expect(tool.content).toContain("Alice's audit");
      expect(tool.content).not.toContain("Bob's secret project");

      const conv = await prisma.aiConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      expect(conv.provider).toBe("gemini");
      const { token } = await login("alice@test.dev");
      const t = await api(token).get(`/api/ai/conversations/${r.conversationId}`);
      expect(t.body.messages[1]).toMatchObject({ text: "One overdue task: Alice's audit.", toolsUsed: ["search_tasks"] });

      // A conversation can't silently switch formats between providers.
      config.AI_PROVIDER = "anthropic";
      await expect(chat(asAuth(team.alice), "More?", r.conversationId)).rejects.toMatchObject({ status: 409 });
    } finally {
      config.AI_PROVIDER = saved.p;
      config.AI_API_KEY = saved.k;
      setOpenAIClientForTests(null);
    }
  });

  it("does not persist anything when the model call fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    setClientForTests({ beta: { messages: { create } } } as unknown as Anthropic);
    await expect(chat(asAuth(team.alice), "Hello")).rejects.toMatchObject({ status: 502 });
    expect(await prisma.aiMessage.count()).toBe(0);
  });

  it("users cannot read each other's conversations", async () => {
    const create = vi.fn().mockResolvedValue({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "Hi" }] });
    setClientForTests({ beta: { messages: { create } } } as unknown as Anthropic);
    const r = await chat(asAuth(team.alice), "Hello");
    const { token } = await login("bob@test.dev");
    expect((await api(token).get(`/api/ai/conversations/${r.conversationId}`)).status).toBe(404);
    await expect(chat(asAuth(team.bob), "Hijack", r.conversationId)).rejects.toMatchObject({ status: 404 });
  });
});
