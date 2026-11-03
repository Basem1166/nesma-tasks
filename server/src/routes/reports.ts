import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auth, notFound, parse } from "../lib/http.js";
import { loadTeamMetrics, monthRange } from "../reports/metrics.js";
import { generateMonthlyReport } from "../reports/report.js";

/** Leader-only (mounted behind requireRole in app.ts). */
export const reportsRouter = Router();

reportsRouter.get("/", async (req, res) => {
  const reports = await prisma.report.findMany({
    where: { teamId: auth(req).teamId },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      aiGenerated: true,
      model: true,
      createdAt: true,
      generatedBy: { select: { name: true } },
    },
  });
  res.json({ reports });
});

const Period = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** Live metrics for any month, without generating a narrative. */
reportsRouter.get("/preview", async (req, res) => {
  const { year, month } = parse(Period, req.query);
  const { start, end } = monthRange(year, month);
  res.json({ metrics: await loadTeamMetrics(auth(req).teamId, start, end) });
});

reportsRouter.post("/generate", async (req, res) => {
  const user = auth(req);
  const { year, month } = parse(Period, req.body);
  const report = await generateMonthlyReport({ teamId: user.teamId, year, month, generatedById: user.id });
  res.status(201).json({ report: { ...report, metrics: JSON.parse(report.metrics) } });
});

reportsRouter.get("/:id", async (req, res) => {
  const report = await prisma.report.findFirst({
    where: { id: req.params.id as string, teamId: auth(req).teamId },
    include: { generatedBy: { select: { name: true } } },
  });
  if (!report) throw notFound("Report");
  res.json({ report: { ...report, metrics: JSON.parse(report.metrics) } });
});
