export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

export const FREE_SERVICE_LIMIT = 3;

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

export function parseService(b = {}) {
  const serviceName = String(b.serviceName ?? "").trim();
  const category = String(b.category ?? "");
  const description = String(b.description ?? "").trim();
  const location = String(b.location ?? "").trim();
  const price = Number(b.price);
  const images = Array.isArray(b.images)
    ? b.images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5)
    : [];

  if (serviceName.length < 3 || serviceName.length > 100)
    throw new HttpError(400, "Service name must be between 3 and 100 characters");
  if (!CATEGORIES.includes(category)) throw new HttpError(400, "Please choose a valid category");
  if (description.length < 10 || description.length > 2000)
    throw new HttpError(400, "Description must be between 10 and 2000 characters");
  if (!Number.isFinite(price) || price <= 0 || price > 10000000)
    throw new HttpError(400, "Price must be a positive number");
  if (location.length < 2 || location.length > 100)
    throw new HttpError(400, "Location must be between 2 and 100 characters");
  if (images.length < 1) throw new HttpError(400, "At least one service image is required");

  return { serviceName, category, description, price, location, images };
}
