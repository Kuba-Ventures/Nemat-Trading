import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth";
import { buildSnapshotEmail, lastSendSlot, snapshotWindows } from "../lib/weeklySnapshot";
import { isAllowedTestRecipient, loadSnapshotData, sendSnapshot, snapshotRecipients } from "../lib/weeklySnapshotJob";

// GET  /api/admin/weekly-snapshot       the latest weekly email as it would send, plus who gets it
// POST /api/admin/weekly-snapshot/test  { to } sends that email once to a team address

const router = Router();

router.get("/admin/weekly-snapshot", requireAdmin, async (_req, res) => {
  try {
    const slot = lastSendSlot(new Date());
    const email = buildSnapshotEmail(await loadSnapshotData(slot));
    res.set("Cache-Control", "no-store").json({ ...email, recipients: snapshotRecipients() });
  } catch (err: any) {
    console.error("[weekly-snapshot] preview failed:", err);
    res.status(500).json({ error: err?.message ?? "Preview failed" });
  }
});

router.post("/admin/weekly-snapshot/test", requireAdmin, async (req, res) => {
  const to = String(req.body?.to ?? "").trim();
  if (!isAllowedTestRecipient(to)) {
    return res.status(400).json({ error: "Test sends go to a qsbsrollover.com address only." });
  }
  const slot = lastSendSlot(new Date());
  const ok = await sendSnapshot(slot, [to], `weekly-snapshot-test-${snapshotWindows(slot).key}-${to}-${Date.now()}`);
  return ok ? res.json({ sent: to }) : res.status(502).json({ error: "Send failed, see server logs." });
});

export default router;
