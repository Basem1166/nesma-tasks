/**
 * Demo data: one team, a leader and four members, ~60 tasks spread over the
 * last ~3 months with realistic histories (progress updates, comments, late
 * and on-time completions), plus chat channels. Deterministic (seeded RNG) so
 * every run produces the same dataset relative to "today".
 *
 * All demo accounts use the password: Nesma@2026
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const now = new Date();

let seed = 20261102;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const at = (d: Date, hour = 10) => {
  const x = new Date(d);
  x.setUTCHours(hour, int(0, 59), 0, 0);
  return x;
};

const TITLES = [
  ["Prepare Q4 vendor performance review", "Compile delivery and quality KPIs for the top 10 vendors and draft recommendations."],
  ["Migrate customer records to new CRM", "Export, clean and import ~12k customer records. Validate duplicates."],
  ["Update onboarding handbook", "Refresh the employee onboarding handbook with the new IT and HR policies."],
  ["Fix invoice rounding bug", "Totals on multi-currency invoices are off by 0.01 in some cases."],
  ["Plan team offsite agenda", "Draft agenda, book venue options and collect dietary requirements."],
  ["Audit warehouse safety equipment", "Inspect extinguishers, first-aid kits and signage; log findings."],
  ["Negotiate logistics contract renewal", "Target 8% cost reduction while keeping SLA at 98%."],
  ["Design monthly KPI dashboard", "Wireframe and build the operations KPI dashboard for management."],
  ["Run customer satisfaction survey", "Send survey to 500 customers, analyse NPS and comments."],
  ["Prepare budget forecast for next quarter", "Consolidate department requests and model three scenarios."],
  ["Implement SSO for internal tools", "Connect internal apps to the identity provider via SAML."],
  ["Clean up shared drive permissions", "Remove stale access and apply least-privilege groups."],
  ["Write tender documentation", "Prepare technical and commercial sections for the municipal tender."],
  ["Train staff on new ticketing system", "Two 1-hour sessions plus a short recorded walkthrough."],
  ["Reconcile September expenses", "Match card transactions to receipts and flag anomalies."],
  ["Set up automated backups", "Nightly encrypted backups of the file server with 30-day retention."],
  ["Review supplier compliance certificates", "Check ISO and safety certificates for expiring dates."],
  ["Create social media content calendar", "Plan 4 weeks of posts aligned with the product launch."],
  ["Optimise delivery routes", "Use last month's data to reduce average route time by 10%."],
  ["Prepare board meeting presentation", "Summarise operational highlights, risks and asks."],
  ["Renew software licences", "Inventory licences expiring this quarter and process renewals."],
  ["Document incident response process", "Write the runbook for security and outage incidents."],
  ["Evaluate new project management tools", "Shortlist three tools and score them against requirements."],
  ["Organise quarterly town hall", "Book hall, coordinate speakers, collect questions."],
  ["Update price list for 2027", "Apply new margins and publish the updated price list."],
  ["Test disaster recovery plan", "Run a failover drill and record recovery times."],
  ["Hire temporary warehouse staff", "Coordinate with agency for 6 temporary staff for peak season."],
  ["Prepare client case study", "Interview the client and write a 2-page case study."],
  ["Review and approve marketing budget", "Validate spend by channel versus last quarter's ROI."],
  ["Install new access control system", "Coordinate install of badge readers at the main entrance."],
  ["Respond to audit findings", "Address the 7 findings from the internal audit with owners and dates."],
  ["Launch employee wellness program", "Partner with the gym and schedule monthly wellness talks."],
  ["Upgrade meeting room AV equipment", "Replace projectors in rooms 2 and 3 with displays."],
  ["Archive closed projects", "Move closed project files to cold storage and update index."],
  ["Build supplier scorecard", "Weighted scorecard for price, quality, delivery and service."],
  ["Prepare monthly operations report", "Collect metrics from each unit and write commentary."],
  ["Improve customer response time", "Reduce first-response time on support tickets below 2 hours."],
  ["Coordinate fleet maintenance", "Schedule servicing for 14 vehicles with minimal downtime."],
  ["Draft remote work policy", "Policy draft covering eligibility, equipment and security."],
  ["Set up new branch network", "Order equipment and configure VPN for the new branch."],
  ["Collect feedback on new uniform", "Short survey to field staff on comfort and durability."],
  ["Digitise paper contracts", "Scan, OCR and tag ~800 legacy contracts."],
  ["Plan Ramadan working hours", "Publish adjusted shift schedules and customer service hours."],
  ["Review insurance policies", "Compare current coverage against three broker quotes."],
  ["Create product training videos", "Record 5 short videos covering the main product features."],
  ["Investigate stock discrepancies", "Cycle count high-value SKUs and trace the variance."],
  ["Prepare ESG data submission", "Collect energy, water and waste data for the ESG report."],
  ["Refresh website FAQ", "Rewrite the top 20 FAQs based on support ticket themes."],
  ["Configure low-stock alerts", "Set reorder thresholds for the 50 fastest-moving SKUs."],
  ["Organise first-aid certification", "Book certification course for 10 floor supervisors."],
  ["Reduce printing costs", "Set default duplex printing and remove 4 underused printers."],
  ["Evaluate solar panel proposal", "Assess ROI of rooftop solar for the main warehouse."],
  ["Map customer onboarding journey", "Identify drop-off points in the onboarding funnel."],
  ["Prepare year-end stock take", "Plan teams, schedule and tools for the year-end count."],
  ["Update emergency contact list", "Verify phone numbers for all staff and contractors."],
  ["Automate weekly sales email", "Generate and send the weekly sales summary automatically."],
  ["Review overtime approvals", "Analyse overtime trends and propose approval rules."],
  ["Coordinate office move to floor 3", "Plan seating, IT moves and the move weekend."],
  ["Clean CRM duplicate contacts", "Merge duplicate contacts flagged by the CRM report."],
  ["Plan customer appreciation event", "Shortlist venues and draft guest list for top accounts."],
] as const;

const COMMENTS = [
  "Started on this, will share a draft by tomorrow.",
  "Blocked waiting on data from finance — following up.",
  "Draft is in the shared folder, please review.",
  "Vendor confirmed, moving forward.",
  "Need one more day for testing.",
  "Done with the first half, rest is straightforward.",
  "Please prioritise this, the client is asking.",
  "Looks good to me 👍",
  "Can we push the deadline by two days?",
  "Found an issue, fixing it now.",
];

async function main() {
  // `--if-empty` (used on hosted demos with an ephemeral disk) seeds a fresh
  // database but never touches one that already has users.
  if (process.argv.includes("--if-empty") && (await prisma.user.count()) > 0) {
    console.log("Database already has data - skipping seed.");
    return;
  }
  console.log("Resetting data...");
  await prisma.$transaction([
    prisma.aiMessage.deleteMany(),
    prisma.aiConversation.deleteMany(),
    prisma.report.deleteMany(),
    prisma.message.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.taskUpdate.deleteMany(),
    prisma.task.deleteMany(),
    prisma.emailLog.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.team.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash("Nesma@2026", 12);
  const team = await prisma.team.create({ data: { name: "Nesma Operations" } });
  const mk = (name: string, email: string, role: string, title: string) =>
    prisma.user.create({ data: { name, email, role, title, passwordHash, teamId: team.id } });

  const leader = await mk("Mona Hassan", "leader@nesma.dev", "LEADER", "Operations Manager");
  const members = [
    await mk("Omar Khaled", "omar@nesma.dev", "MEMBER", "Logistics Coordinator"),
    await mk("Sara Adel", "sara@nesma.dev", "MEMBER", "Business Analyst"),
    await mk("Youssef Nabil", "youssef@nesma.dev", "MEMBER", "IT Specialist"),
    await mk("Laila Mahmoud", "laila@nesma.dev", "MEMBER", "HR & Admin Officer"),
  ];
  // Members differ in reliability so the reports have something to say.
  const reliability: Record<string, number> = {
    [members[0]!.id]: 0.85,
    [members[1]!.id]: 0.95,
    [members[2]!.id]: 0.6,
    [members[3]!.id]: 0.8,
  };

  console.log("Creating tasks...");
  let fresh = 0;
  for (const [i, [title, description]] of TITLES.entries()) {
    const assignee = i % 13 === 12 ? null : pick(members);
    const priority = pick(["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "URGENT"] as const);
    const created = at(new Date(now.getTime() - between(1, 95) * DAY), 9);
    let due: Date | null = i % 17 === 5 ? null : at(new Date(created.getTime() + between(3, 21) * DAY), 17);
    // Make a couple of tasks due within the next day so the reminder automation has work.
    if (i === 7 || i === 33) due = new Date(now.getTime() + between(4, 20) * 3_600_000);

    let status = "TODO";
    let progress = 0;
    let completedAt: Date | null = null;
    const rel = assignee ? reliability[assignee.id]! : 0.5;

    if (due && due.getTime() < now.getTime() - 2 * DAY) {
      if (rand() < 0.82 && assignee) {
        status = "DONE";
        progress = 100;
        const late = rand() > rel;
        const offset = late ? between(0.5, 6) : -between(0, 4);
        completedAt = new Date(Math.min(Math.max(due.getTime() + offset * DAY, created.getTime() + DAY), now.getTime() - 3_600_000));
      } else {
        status = pick(["IN_PROGRESS", "IN_PROGRESS", "TODO", "IN_REVIEW"]);
        progress = status === "TODO" ? 0 : int(2, 8) * 10;
      }
    } else {
      status = pick(["TODO", "IN_PROGRESS", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
      if (!assignee) status = "TODO";
      progress = status === "TODO" ? 0 : status === "DONE" ? 100 : status === "IN_REVIEW" ? 90 : int(1, 8) * 10;
      if (status === "DONE") completedAt = new Date(Math.min(now.getTime() - 3_600_000, created.getTime() + between(1, 6) * DAY));
    }

    const isOverdue = !!due && status !== "DONE" && due < now;
    // Older alerts count as already sent; leave one or two "fresh" ones for the first automation run.
    const markOverdue = isOverdue && (now.getTime() - due!.getTime() > 2 * DAY || fresh++ >= 1);
    const lastTouch = completedAt ?? new Date(Math.min(now.getTime(), created.getTime() + between(0.2, 5) * DAY));

    const task = await prisma.task.create({
      data: {
        title,
        description,
        priority,
        status,
        progress,
        dueDate: due,
        completedAt,
        teamId: team.id,
        assigneeId: assignee?.id ?? null,
        createdById: rand() < 0.85 || !assignee ? leader.id : assignee.id,
        createdAt: created,
        updatedAt: lastTouch,
        reminderSentAt: due && due < new Date(now.getTime() + DAY) && !(i === 7 || i === 33) ? due : null,
        overdueNotifiedAt: markOverdue ? new Date(due!.getTime() + 600_000) : null,
      },
    });

    // Activity history that tells the same story as the final state.
    const updates: { userId: string | null; type: string; message: string; createdAt: Date; fromValue?: string; toValue?: string }[] = [
      { userId: leader.id, type: "CREATED", message: `${leader.name} created the task`, createdAt: created },
    ];
    if (assignee) {
      updates.push({ userId: leader.id, type: "ASSIGNED", message: `Assigned to ${assignee.name}`, createdAt: new Date(created.getTime() + 60_000), toValue: assignee.id });
      const end = (completedAt ?? lastTouch).getTime();
      const steps = progress === 0 ? 0 : Math.min(4, Math.ceil(progress / 30));
      let prev = 0;
      for (let s = 1; s <= steps; s++) {
        const p = s === steps ? progress : Math.min(progress, Math.round((progress / steps) * s / 10) * 10);
        const t = new Date(created.getTime() + ((end - created.getTime()) * s) / (steps + 1));
        if (s === 1) updates.push({ userId: assignee.id, type: "STATUS", message: "Moved from To do to In progress", createdAt: t, fromValue: "TODO", toValue: "IN_PROGRESS" });
        if (p !== prev) updates.push({ userId: assignee.id, type: "PROGRESS", message: `Progress ${prev}% → ${p}%`, createdAt: new Date(t.getTime() + 1000), fromValue: String(prev), toValue: String(p) });
        prev = p;
        if (rand() < 0.35) updates.push({ userId: pick([assignee.id, leader.id]), type: "COMMENT", message: pick(COMMENTS), createdAt: new Date(t.getTime() + 3_600_000) });
      }
      if (status === "IN_REVIEW") updates.push({ userId: assignee.id, type: "STATUS", message: "Moved from In progress to In review", createdAt: lastTouch, fromValue: "IN_PROGRESS", toValue: "IN_REVIEW" });
      if (status === "DONE") updates.push({ userId: assignee.id, type: "STATUS", message: "Moved from In progress to Done", createdAt: completedAt!, fromValue: "IN_PROGRESS", toValue: "DONE" });
    }
    if (markOverdue) updates.push({ userId: null, type: "OVERDUE", message: "Task became overdue", createdAt: new Date(due!.getTime() + 600_000) });
    await prisma.taskUpdate.createMany({ data: updates.map((u) => ({ ...u, taskId: task.id })) });
  }

  console.log("Creating channels...");
  const general = await prisma.channel.create({ data: { name: "general", topic: "Team-wide announcements and chat", teamId: team.id } });
  const ops = await prisma.channel.create({ data: { name: "operations", topic: "Day-to-day operations coordination", teamId: team.id } });
  await prisma.channel.create({ data: { name: "it-support", topic: "IT requests and incidents", teamId: team.id } });
  const chatter: [string, string, string][] = [
    [general.id, leader.id, "Good morning team! Reminder: monthly review is on Thursday at 11:00."],
    [general.id, members[1]!.id, "Thanks Mona, I'll bring the KPI dashboard draft."],
    [general.id, members[0]!.id, "Logistics contract call moved to 2pm today."],
    [ops.id, members[2]!.id, "Backups are now running nightly, first restore test went fine."],
    [ops.id, leader.id, "Great work Youssef. Can you also look at the SSO task this week?"],
    [ops.id, members[3]!.id, "Temporary staff start on Sunday, onboarding packs are ready."],
  ];
  for (const [k, [channelId, userId, body]] of chatter.entries()) {
    await prisma.message.create({ data: { channelId, userId, body, createdAt: new Date(now.getTime() - (chatter.length - k) * 47 * 60_000) } });
  }

  const counts = await prisma.task.groupBy({ by: ["status"], _count: true });
  console.log("Seed complete:", counts.map((c) => `${c.status}=${c._count}`).join(" "));
  console.log("Accounts (password Nesma@2026): leader@nesma.dev, omar@, sara@, youssef@, laila@nesma.dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
