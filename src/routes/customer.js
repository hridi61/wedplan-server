import { Router } from "express";
import { col, oid, publicVendor, usersById } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { HttpError } from "../utils.js";

const router = Router();

// Any signed-in user: own profile data (role/subscription are read-only here)
router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

router.post("/bookings", authenticate, async (req, res) => {
  const { serviceId, eventDate, eventLocation, message = "" } = req.body || {};
  const _id = oid(serviceId);
  const service = _id && (await (await col("services")).findOne({ _id }));
  if (!service) throw new HttpError(404, "Service not found");

  if (req.user.role === "admin") throw new HttpError(403, "Admins cannot submit booking requests");
  if (service.vendorId === req.user.id) throw new HttpError(403, "You cannot book your own service");
  if (req.user.role !== "customer") throw new HttpError(403, "Only customers can submit booking requests");
  if (service.status !== "approved" || service.isActive === false)
    throw new HttpError(400, "This service is not available for booking");

  const date = String(eventDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
    throw new HttpError(400, "Please choose a valid event date");
  if (new Date(date) < new Date(new Date().toISOString().slice(0, 10)))
    throw new HttpError(400, "Event date cannot be in the past");
  const location = String(eventLocation || "").trim();
  if (location.length < 2 || location.length > 150) throw new HttpError(400, "Event location is required");
  const note = String(message).trim().slice(0, 1000);

  const B = await col("bookings");
  const duplicate = await B.findOne({
    customerId: req.user.id,
    serviceId: String(service._id),
    eventDate: date,
    status: { $in: ["pending", "accepted"] },
  });
  if (duplicate) throw new HttpError(409, "You already have an active request for this service on that date");

  const now = new Date();
  const { insertedId } = await B.insertOne({
    serviceId: String(service._id),
    vendorId: service.vendorId,
    customerId: req.user.id,
    eventDate: date,
    eventLocation: location,
    message: note,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ id: String(insertedId), message: "Booking request sent to the vendor" });
});

router.get("/customer/overview", authenticate, requireRole("customer"), async (req, res) => {
  const B = await col("bookings");
  const c = req.user.id;
  const [total, pending, accepted, rejected] = await Promise.all([
    B.countDocuments({ customerId: c }),
    B.countDocuments({ customerId: c, status: "pending" }),
    B.countDocuments({ customerId: c, status: "accepted" }),
    B.countDocuments({ customerId: c, status: "rejected" }),
  ]);
  res.json({ total, pending, accepted, rejected });
});

router.get("/customer/bookings", authenticate, requireRole("customer"), async (req, res) => {
  const bookings = await (await col("bookings")).find({ customerId: req.user.id }).sort({ createdAt: -1 }).toArray();
  const services = await (await col("services"))
    .find({ _id: { $in: bookings.map((b) => oid(b.serviceId)).filter(Boolean) } })
    .toArray();
  const sMap = new Map(services.map((s) => [String(s._id), s]));
  const vendors = await usersById(bookings.map((b) => b.vendorId));

  res.json({
    items: bookings.map(({ _id, ...b }) => {
      const s = sMap.get(b.serviceId);
      return {
        id: String(_id),
        ...b,
        service: s ? { id: String(s._id), serviceName: s.serviceName, images: s.images, category: s.category, price: s.price } : null,
        vendor: publicVendor(vendors.get(b.vendorId)),
      };
    }),
  });
});

router.patch("/customer/bookings/:id/cancel", authenticate, requireRole("customer"), async (req, res) => {
  const _id = oid(req.params.id);
  const B = await col("bookings");
  const result = await B.findOneAndUpdate(
    { _id, customerId: req.user.id, status: "pending" },
    { $set: { status: "cancelled", updatedAt: new Date() } }
  );
  if (!result) {
    const existing = _id && (await B.findOne({ _id }));
    if (!existing || existing.customerId !== req.user.id) throw new HttpError(404, "Booking not found");
    throw new HttpError(409, `A ${existing.status} booking cannot be cancelled`);
  }
  res.json({ message: "Booking request cancelled" });
});

export default router;
