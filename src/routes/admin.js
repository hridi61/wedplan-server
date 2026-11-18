import { Router } from "express";
import { col, oid, serializeUser, userIdFilter, usersById, withVendors } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { CATEGORIES, HttpError, escapeRegex } from "../utils.js";

const router = Router();
router.use(authenticate, requireRole("admin"));

router.get("/overview", async (_req, res) => {
  const U = await col("users");
  const S = await col("services");
  const T = await col("transactions");
  const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions] =
    await Promise.all([
      U.countDocuments({}),
      U.countDocuments({ role: "vendor" }),
      U.countDocuments({ role: "customer" }),
      S.countDocuments({}),
      S.countDocuments({ status: "pending" }),
      T.countDocuments({}),
    ]);
  res.json({ totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions });
});

router.get("/users", async (req, res) => {
  const { q, role } = req.query;
  const filter = {};
  if (["admin", "vendor", "customer"].includes(role)) filter.role = role;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const users = await (await col("users")).find(filter).sort({ createdAt: -1 }).limit(200).toArray();
  res.json({ items: users.map(serializeUser) });
});

router.get("/users/:id", async (req, res) => {
  const user = (await usersById([req.params.id])).get(req.params.id);
  if (!user) throw new HttpError(404, "User not found");
  const id = String(user._id);
  const [services, bookingsAsCustomer, bookingsAsVendor] = await Promise.all([
    (await col("services")).countDocuments({ vendorId: id }),
    (await col("bookings")).countDocuments({ customerId: id }),
    (await col("bookings")).countDocuments({ vendorId: id }),
  ]);
  res.json({ user: serializeUser(user), stats: { services, bookingsAsCustomer, bookingsAsVendor } });
});

router.patch("/users/:id/block", async (req, res) => {
  if (typeof req.body?.isBlocked !== "boolean") throw new HttpError(400, "isBlocked must be true or false");
  const U = await col("users");
  const user = await U.findOne(userIdFilter(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  if (user.role === "admin") throw new HttpError(403, "Admin accounts cannot be blocked");

  await U.updateOne({ _id: user._id }, { $set: { isBlocked: req.body.isBlocked, updatedAt: new Date() } });
  if (req.body.isBlocked) {
    // End any active sessions so a blocked user is signed out immediately
    const id = String(user._id);
    await (await col("session")).deleteMany({ userId: { $in: [id, user._id] } });
  }
  res.json({ message: req.body.isBlocked ? "User blocked" : "User unblocked" });
});

router.get("/services", async (req, res) => {
  const { q, status, category } = req.query;
  const filter = {};
  if (["pending", "approved", "rejected"].includes(status)) filter.status = status;
  if (CATEGORIES.includes(category)) filter.category = category;
  if (q) filter.serviceName = new RegExp(escapeRegex(String(q).slice(0, 80)), "i");
  const items = await (await col("services")).find(filter).sort({ createdAt: -1 }).limit(300).toArray();
  res.json({ items: await withVendors(items) });
});

router.patch("/services/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(status)) throw new HttpError(400, "Invalid status");
  const result = await (await col("services")).updateOne(
    { _id: oid(req.params.id) },
    { $set: { status, reviewedAt: new Date(), updatedAt: new Date() } }
  );
  if (!result.matchedCount) throw new HttpError(404, "Service not found");
  res.json({ message: `Service ${status}` });
});

router.delete("/services/:id", async (req, res) => {
  const result = await (await col("services")).deleteOne({ _id: oid(req.params.id) });
  if (!result.deletedCount) throw new HttpError(404, "Service not found");
  res.json({ message: "Service deleted" });
});

// Read-only: there is intentionally no route that edits a transaction
router.get("/transactions", async (_req, res) => {
  const txs = await (await col("transactions")).find({}).sort({ createdAt: -1 }).limit(300).toArray();
  const vendors = await usersById(txs.map((t) => t.vendorId));
  res.json({
    items: txs.map(({ _id, ...t }) => {
      const v = vendors.get(String(t.vendorId));
      return { id: String(_id), ...t, vendor: v ? { name: v.name, email: v.email, businessName: v.businessName || null } : null };
    }),
  });
});

export default router;
