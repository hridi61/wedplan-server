import { createRemoteJWKSet, jwtVerify } from "jose";
import { findUser, serializeUser } from "../db.js";
import { HttpError } from "../utils.js";

export const JWT_AUDIENCE = "wedplan-api";
const base = () => (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");

let jwks;
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(`${base()}/api/auth/jwks`)));

/**
 * Verifies the Better Auth JWT (signature, expiry, issuer, audience) and then loads the
 * user from MongoDB. Role and blocked state ALWAYS come from the database, never from the token.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Authentication required");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(), { issuer: base(), audience: JWT_AUDIENCE }));
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const user = await findUser(payload.sub || payload.id);
  if (!user) throw new HttpError(401, "Account not found");
  if (user.isBlocked) throw new HttpError(403, "Your account has been blocked", "BLOCKED");

  req.user = serializeUser(user);
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      throw new HttpError(403, "You do not have permission to perform this action");
    next();
  };
