import { Router } from "express";
import { checkAdminPassword, signAdminToken } from "../lib/adminAuth";
import { createRateLimiter } from "../lib/rate-limit";

const router = Router();

// Slow down password guessing: 10 tries per 15 minutes per client.
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/admin/login", loginLimiter, (req, res) => {
  const { password } = (req.body ?? {}) as { password?: unknown };
  if (!checkAdminPassword(password)) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  const signed = signAdminToken();
  if (!signed) {
    res.status(500).json({ error: "Admin login not configured" });
    return;
  }
  res.json(signed);
});

export default router;
