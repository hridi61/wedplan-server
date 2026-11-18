import { Router } from "express";
import { col, isPremium, oid, publicVendor, usersById, withVendors } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { FREE_SERVICE_LIMIT, HttpError, parseService } from "../utils.js";

const router = Router();
router.use(authenticate, requireRole("vendor"));

const countActive = async (vendorId, excludeId) => {
  const filter = { vendorId, isActive: true, status: { $ne: "rejected" } };
  if (excludeId) filter._id = { $ne: excludeId };
  return (await col("services")).countDocuments(filter);
};

const limitError = () =>
  new HttpError(
    403,
    `Free vendors can keep ${FREE_SERVICE_LIMIT} active services. Upgrade to Premium for unlimited services.`,
    "LIMIT_REACHED"
  );

router.get("/overview", async (req, res) => {
  const vendorId = req.user.id;
  const S = await col("services");
  const B = await col("bookings");
  const [totalServices, activeServices, pendingRequests, acceptedBookings] = await Promise.all([
    S.countDocuments({ vendorId }),
    S.countDocuments({ vendorId, status: "approved", isActive: true }),
    B.countDocuments({ vendorId, status: "pending" }),
    B.countDocuments({ vendorId, status: "accepted" }),
  ]);
  res.json({
    totalServices,
    activeServices,
    pendingRequests,
    acceptedBookings,
    plan: req.user.subscriptionPlan,
    subscriptionExpiresAt: req.user.subscriptionExpiresAt,
  });
});

router.get("/services", async (req, res) => {
  const items = await (await col("services")).find({ vendorId: req.user.id }).sort({ createdAt: -1 }).toArray();
  res.json({ items: await withVendors(items) });
});

router.post("/services", async (req, res) => {
  const data = parseService(req.body);
  const user = (await usersById([req.user.id])).get(req.user.id);
  if (!isPremium(user) && (await countActive(req.user.id)) >= FREE_SERVICE_LIMIT) throw limitError();

  const now = new Date();
  const doc = { vendorId: req.user.id, ...data, status: "pending", isActive: true, createdAt: now, updatedAt: now };
  const { insertedId } = await (await col("services")).insertOne(doc);
  res.status(201).json({ id: String(insertedId), message: "Service submitted for admin approval" });
});

router.patch("/services/:id", async (req, res) => {
  const _id = oid(req.params.id);
  const S = await col("services");
  const service = _id && (await S.findOne({ _id }));
  if (!service) throw new HttpError(404, "Service not found");
  if (service.vendorId !== req.user.id) throw new HttpError(403, "You can only manage your own services");

  const $set = { updatedAt: new Date() };
  const hasContent = ["serviceName", "category", "description", "price", "location", "images"].some(
    (k) => k in req.body
  );

  if (hasContent) {
    Object.assign($set, parseService({ ...service, ...req.body }));
    // Edited content must be re-reviewed by an admin
    $set.status = "pending";
  }
  if (typeof req.body.isActive === "boolean") {
    if (req.body.isActive && service.isActive === false && service.status !== "rejected") {
      const user = (await usersById([req.user.id])).get(req.user.id);
      if (!isPremium(user) && (await countActive(req.user.id, _id)) >= FREE_SERVICE_LIMIT) throw limitError();
    }
    $set.isActive = req.body.isActive;
  }
  await S.updateOne({ _id }, { $set });
  res.json({ message: hasContent ? "Service updated and sent for re-approval" : "Service updated" });
});

router.delete("/services/:id", async (req, res) => {
  const _id = oid(req.params.id);
  const S = await col("services");
  const service = _id && (await S.findOne({ _id }));
  if (!service) throw new HttpError(404, "Service not found");
  if (service.vendorId !== req.user.id) throw new HttpError(403, "You can only manage your own services");
  await S.deleteOne({ _id });
  res.json({ message: "Service deleted" });
});

router.get("/bookings", async (req, res) => {
  const bookings = await (await col("bookings")).find({ vendorId: req.user.id }).sort({ createdAt: -1 }).toArray();
  const services = await (await col("services"))
    .find({ _id: { $in: bookings.map((b) => oid(b.serviceId)).filter(Boolean) } })
    .toArray();
  const sMap = new Map(services.map((s) => [String(s._id), s]));
  const customers = await usersById(bookings.map((b) => b.customerId));

  res.json({
    items: bookings.map(({ _id, ...b }) => {
      const s = sMap.get(b.serviceId);
      const c = customers.get(b.customerId);
      return {
        id: String(_id),
        ...b,
        service: s ? { id: String(s._id), serviceName: s.serviceName, images: s.images, category: s.category, price: s.price } : null,
        customer: c ? { name: c.name, email: c.email, phone: c.phone || null, image: c.image || null } : null,
      };
    }),
  });
});

router.patch("/bookings/:id", async (req, res) => {
  const { status } = req.body || {};
  if (!["accepted", "rejected"].includes(status)) throw new HttpError(400, "Status must be accepted or rejected");
  const _id = oid(req.params.id);
  const B = await col("bookings");

  // Atomic: only the owning vendor, and only while still pending
  const result = await B.findOneAndUpdate(
    { _id, vendorId: req.user.id, status: "pending" },
    { $set: { status, updatedAt: new Date() } }
  );
  if (!result) {
    const existing = _id && (await B.findOne({ _id }));
    if (!existing || existing.vendorId !== req.user.id) throw new HttpError(404, "Booking request not found");
    throw new HttpError(409, `This request was already ${existing.status} and cannot be processed again`);
  }
  res.json({ message: `Booking request ${status}` });
});

export default router;
