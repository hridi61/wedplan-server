import { MongoClient, ObjectId } from "mongodb";
import { isObjectId } from "./utils.js";

let dbPromise;

export function getDb() {
  if (!dbPromise) {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client.connect().then((c) => c.db(process.env.MONGODB_DB || "wedplan"));
    dbPromise.catch(() => (dbPromise = undefined));
  }
  return dbPromise;
}

export const col = async (name) => (await getDb()).collection(name);
export const oid = (id) => (isObjectId(String(id)) ? new ObjectId(String(id)) : null);

// Better Auth stores users in the "users" collection. Depending on adapter version the _id
// may be an ObjectId or a string, so lookups accept both.
export const userIdFilter = (id) => ({ _id: { $in: [oid(id), String(id)].filter(Boolean) } });

export const isPremium = (u) =>
  u?.subscriptionPlan === "premium" &&
  (!u.subscriptionExpiresAt || new Date(u.subscriptionExpiresAt) > new Date());

export const serializeUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  image: u.image || null,
  role: u.role || "customer",
  isBlocked: !!u.isBlocked,
  businessName: u.businessName || null,
  phone: u.phone || null,
  subscriptionPlan: isPremium(u) ? "premium" : "free",
  subscriptionExpiresAt: u.subscriptionExpiresAt || null,
  createdAt: u.createdAt,
});

export async function findUser(id) {
  if (!id) return null;
  return (await col("users")).findOne(userIdFilter(id));
}

export async function usersById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const all = unique.flatMap((i) => (isObjectId(i) ? [i, new ObjectId(i)] : [i]));
  const users = await (await col("users")).find({ _id: { $in: all } }).toArray();
  return new Map(users.map((u) => [String(u._id), u]));
}

export const publicVendor = (u) =>
  u
    ? {
        id: String(u._id),
        name: u.name,
        businessName: u.businessName || null,
        image: u.image || null,
        isPremium: isPremium(u),
      }
    : null;

export function serviceOut(s, vendors) {
  const { _id, ...rest } = s;
  return { id: String(_id), ...rest, vendor: vendors ? publicVendor(vendors.get(String(s.vendorId))) : undefined };
}

export async function withVendors(services) {
  const vendors = await usersById(services.map((s) => s.vendorId));
  return services.map((s) => serviceOut(s, vendors));
}
