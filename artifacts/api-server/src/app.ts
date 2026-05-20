import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import router from "./routes";
import { handleStripeWebhook } from "./routes/webhooks";

const app: Express = express();

app.use(cors());

// Stripe webhook needs the raw request body for signature verification.
// Must be mounted BEFORE express.json() so the body isn't parsed first.
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded product images
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api", router);

// Return JSON errors instead of Express's default HTML error page
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({ error: err.message ?? "Internal server error" });
});

export default app;
