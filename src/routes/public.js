import { Router } from "express";
import { col, oid, withVendors } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { CATEGORIES, HttpError, escapeRegex } from "../utils.js";

const router = Router();
const visible = { status: "approved", isActive: { $ne: false } };

// Public: approved + active services with search, filters, sorting and pagination
router.get("/", async (req, res) => {
  const { q, category, location, sort = "newest" } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 9));

  const filter = { ...visible };
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), "i");
    filter.$or = [{ serviceName: rx }, { description: rx }];
  }
  if (category && CATEGORIES.includes(category)) filter.category = category;
  if (location) filter.location = new RegExp(escapeRegex(String(location).slice(0, 80)), "i");

  const sorts = { price_asc: { price: 1 }, price_desc: { price: -1 }, newest: { createdAt: -1 } };
  const S = await col("services");
  const [items, total] = await Promise.all([
    S.find(filter)
      .sort(sorts[sort] || sorts.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    S.countDocuments(filter),
  ]);
  res.json({ items: await withVendors(items), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get("/featured", async (req, res) => {
  const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
  const items = await (await col("services")).find(visible).sort({ createdAt: -1 }).limit(limit).toArray();
  res.json({ items: await withVendors(items) });
});

router.get("/categories", async (_req, res) => {
  const rows = await (await col("services"))
    .aggregate([{ $match: visible }, { $group: { _id: "$category", count: { $sum: 1 } } }])
    .toArray();
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  res.json({ items: CATEGORIES.map((name) => ({ name, count: counts[name] || 0 })) });
});

// Private: service details (customers see only approved + active services)
router.get("/:id", authenticate, async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) throw new HttpError(404, "Service not found");
  const service = await (await col("services")).findOne({ _id });
  if (!service) throw new HttpError(404, "Service not found");

  const isOwner = service.vendorId === req.user.id;
  const isPublic = service.status === "approved" && service.isActive !== false;
  if (!isPublic && !isOwner && req.user.role !== "admin") throw new HttpError(404, "Service not found");

  const [item] = await withVendors([service]);
  res.json({ item, bookable: isPublic });
});

export default router;
