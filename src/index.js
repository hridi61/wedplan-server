import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { HttpError } from "./utils.js";
import publicRoutes from "./routes/public.js";
import vendorRoutes from "./routes/vendor.js";
import customerRoutes from "./routes/customer.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes, { webhookHandler } from "./routes/payments.js";

const app = express();
const origins = (process.env.CLIENT_URL || "http://localhost:3000").split(",").map((o) => o.trim().replace(/\/$/, ""));

app.use(helmet());
app.use(cors({ origin: origins, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));

// Stripe needs the untouched raw body to verify signatures, so this comes BEFORE express.json()
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhookHandler);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ name: "WedPlan API", status: "ok" }));
app.use("/api/services", publicRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", customerRoutes);

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, code: err.code });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body" });
  console.error(err);
  res.status(500).json({ message: "Something went wrong on our side. Please try again." });
});

const port = process.env.PORT || 5000;
if (!process.env.VERCEL) app.listen(port, () => console.log(`WedPlan API running on port ${port}`));

export default app;
