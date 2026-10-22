import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth";
import { readRecentChecksForAllServices } from "../lib/dependencyHealthJob";
import { buildHealthReport, healthWindowDays, requiredSecretsPresence } from "../lib/dependencySummary";

// GET /api/admin/dependency-health  every dependency's status, 7 day timeline,
// uptime and incidents, plus which required secrets exist (never their values),
// for the admin Health and Map views, the red banner and the nav badge.

const router = Router();

router.get("/admin/dependency-health", requireAdmin, async (_req, res) => {
  try {
    const nowMilliseconds = Date.now();
    const windowStartIso = new Date(nowMilliseconds - healthWindowDays * 24 * 60 * 60 * 1000).toISOString();
    const checksByService = await readRecentChecksForAllServices(windowStartIso);
    res.set("Cache-Control", "no-store").json(buildHealthReport(checksByService, requiredSecretsPresence(), nowMilliseconds));
  } catch (err: any) {
    console.error("[dependency-health] reading checks failed:", err);
    res.status(500).json({ error: err?.message ?? "Couldn't read the health checks" });
  }
});

export default router;
