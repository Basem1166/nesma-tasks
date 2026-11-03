import { AI_MODEL, aiProvider, describeAiError, FALLBACK_BETA, getClient, getOpenAIClient, isAiConfigured } from "../ai/client.js";
import { prisma } from "../db.js";
import { bus } from "../services/events.js";
import { loadTeamMetrics, monthRange, type TeamMetrics } from "./metrics.js";

const REPORT_SYSTEM = `You are the performance analyst for a small operations team. You write the team's monthly report for the team leader.

You receive a JSON object of metrics computed from the team's real task data. Rules:
- Use only numbers that appear in the JSON. Never invent tasks, people or figures. If something cannot be concluded from the data, say so.
- Compare against the "previous" period where it adds insight (e.g. "completion rate rose from 62% to 78%").
- Name people when recognising achievements or flagging workload, in a fair, constructive tone.
- Write GitHub-flavoured Markdown with exactly these sections, in order:
  ## Executive summary   (3-4 sentences)
  ## Completion & throughput
  ## Team performance   (include a Markdown table: Member | Completed | On-time % | Overdue open | Completion %)
  ## Delays & risks
  ## Achievements
  ## Recommendations   (3-5 concrete, actionable bullets for next month)
- Do not add a title above the first section; the app renders one.`;

export async function writeNarrative(metrics: TeamMetrics): Promise<{ narrative: string; aiGenerated: boolean; model: string | null }> {
  if (!isAiConfigured()) return { narrative: ruleBasedNarrative(metrics), aiGenerated: false, model: null };
  const prompt = `Metrics for ${metrics.periodLabel}:\n\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\``;
  try {
    if (aiProvider() !== "anthropic") {
      const response = await getOpenAIClient().chat.completions.create({
        model: AI_MODEL(),
        messages: [
          { role: "system", content: REPORT_SYSTEM },
          { role: "user", content: prompt },
        ],
      });
      const text = response.choices[0]?.message.content?.trim();
      if (!text) throw new Error("empty response");
      return { narrative: text, aiGenerated: true, model: response.model || AI_MODEL() };
    }
    const response = await getClient().beta.messages.create({
      model: AI_MODEL(),
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: REPORT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined to write the report");
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("empty response");
    return { narrative: text, aiGenerated: true, model: response.model };
  } catch (e) {
    console.error("[report] AI narrative failed, using rule-based fallback:", describeAiError(e), e);
    return {
      narrative: `> AI narrative unavailable (${describeAiError(e)}). Showing an automatic summary.\n\n${ruleBasedNarrative(metrics)}`,
      aiGenerated: false,
      model: null,
    };
  }
}

/** Deterministic narrative used when no AI credentials are configured or the call fails. */
export function ruleBasedNarrative(m: TeamMetrics): string {
  const s = m.summary;
  const p = m.previous;
  const delta = (a: number, b: number) => (a === b ? "unchanged" : a > b ? `up from ${b}` : `down from ${b}`);
  const table = [
    "| Member | Completed | On-time % | Overdue open | Completion % |",
    "|---|---|---|---|---|",
    ...m.members.filter((x) => x.workload || x.overdueOpen).map(
      (x) => `| ${x.name} | ${x.completed} | ${x.onTimeRate}% | ${x.overdueOpen} | ${x.completionRate}% |`,
    ),
  ].join("\n");
  return `## Executive summary
In ${m.periodLabel} the team completed ${s.completed} tasks out of a workload of ${s.workload}, a completion rate of ${s.completionRate}% (${delta(s.completionRate, p.completionRate)}%). ${s.onTimeRate}% of completed tasks were delivered on time and ${s.overdueOpen} tasks were overdue at period end.

## Completion & throughput
- Tasks created: ${s.created}
- Tasks completed: ${s.completed} (${delta(s.completed, p.completed)})
- Average cycle time: ${s.avgCycleDays} days

## Team performance
${table}

## Delays & risks
${m.delays.stillOverdue.length ? m.delays.stillOverdue.map((d) => `- **${d.title}** (${d.assignee}) — ${d.daysOverdue} days overdue at ${d.progress}%`).join("\n") : "- No overdue tasks at period end."}
${m.delays.completedLate.length ? `\nCompleted late:\n${m.delays.completedLate.map((d) => `- ${d.title} (${d.assignee}) — ${d.daysLate} days late`).join("\n")}` : ""}

## Achievements
${m.achievements.topPerformers.map((t) => `- ${t.name}: ${t.completed} tasks completed, ${t.onTimeRate}% on time`).join("\n") || "- No completions this period."}

## Recommendations
- Review the overdue items above in the next stand-up and re-plan their deadlines.
- Balance workload toward members with lower open-task counts.
`;
}

export async function generateMonthlyReport(opts: { teamId: string; year: number; month: number; generatedById?: string }) {
  const { start, end } = monthRange(opts.year, opts.month);
  const metrics = await loadTeamMetrics(opts.teamId, start, end);
  const { narrative, aiGenerated, model } = await writeNarrative(metrics);
  const report = await prisma.report.create({
    data: {
      teamId: opts.teamId,
      periodStart: start,
      periodEnd: end,
      metrics: JSON.stringify(metrics),
      narrative,
      aiGenerated,
      model,
      generatedById: opts.generatedById ?? null,
    },
  });
  await bus.emit("report.generated", { report });
  return report;
}
