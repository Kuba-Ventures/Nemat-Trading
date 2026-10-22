import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth";
import { readRecentChecksForAllServices } from "../lib/aiHealthJob";
import { buildAiHealthReport, healthWindowDays } from "../lib/aiHealthSummary";

// GET /api/admin/ai-health  per service status, 7 day timeline, uptime and incidents
// for the admin Health view, the red banner and the nav badge.

const router = Router();

router.get("/admin/ai-health", requireAdmin, async (_req, res) => {
  try {
    const nowMilliseconds = Date.now();
    const windowStartIso = new Date(nowMilliseconds - healthWindowDays * 24 * 60 * 60 * 1000).toISOString();
    const checksByService = await readRecentChecksForAllServices(windowStartIso);
    res.set("Cache-Control", "no-store").json(buildAiHealthReport(checksByService, nowMilliseconds));
  } catch (err: any) {
    console.error("[ai-health] reading checks failed:", err);
    res.status(500).json({ error: err?.message ?? "Couldn't read the AI health checks" });
  }
});

export default router;
