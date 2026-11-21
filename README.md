# WedPlan - Server

Express.js REST API for **WedPlan**, a role-based wedding planning platform.

- **Live API:** [https://wedplan-server-mu.vercel.app](https://wedplan-server-mu.vercel.app)
- **Client repository:** [https://github.com/hridi61/wedplan-client](https://github.com/hridi61/wedplan-client)
- **Server repository:** [https://github.com/hridi61/wedplan-server](https://github.com/hridi61/wedplan-server)

## Important features

- JWT verification middleware (signature, expiry, issuer, audience) using Better Auth's JWKS
- Role middleware for admin, vendor and customer. Role and blocked state are always read from MongoDB, never from the token or the client
- Resource ownership checks on every update, delete, accept, reject and cancel
- Services: public listing with search, category/location filters, price sorting and pagination; vendor CRUD with admin approval workflow and the 3-active-service limit for the Free plan
- Bookings: duplicate prevention (same customer, service and date), self-booking and admin-booking blocks, atomic status changes so a request can only be processed once
- Stripe Checkout subscriptions, with Premium activated **only** by verified webhook events; renewals, cancellation and expiry handled
- Admin: user management (block/unblock, sessions revoked), service moderation, read-only transactions
- Consistent 400/401/403/404/409 errors, Helmet, CORS allow-list

## Technology stack

Node.js 20+, Express 5, MongoDB driver, jose (JWT), Stripe, Helmet, CORS.

## Installation

```bash
git clone https://github.com/hridi61/wedplan-server.git
cd wedplan-server
npm install
cp .env.example .env   # then fill in the values
```

## Run locally

```bash
npm run dev     # http://localhost:5000
```

Start the client repo as well (`BETTER_AUTH_URL` must point to it so JWTs can be verified).

### Stripe webhook locally

```bash
stripe login
stripe listen --forward-to localhost:5000/api/payments/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. Test card: `4242 4242 4242 4242`, any future date, any CVC.

In production, create a webhook endpoint in the Stripe dashboard for `https://<server-domain>/api/payments/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`, `customer.subscription.deleted`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Port for local development (default 5000) |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB connection string and database name (same DB as the client) |
| `CLIENT_URL` | Allowed frontend origin(s), comma separated. Also used for Stripe redirect URLs |
| `BETTER_AUTH_URL` | Origin of the Next.js app that runs Better Auth (JWKS and token issuer) |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint |
| `PREMIUM_PRICE_USD` | Monthly Premium price (default 19) |

Never commit `.env`. `.gitignore` already excludes it.

## API overview

| Area | Endpoints |
| --- | --- |
| Public | `GET /api/services`, `/featured`, `/categories` |
| Any user | `GET /api/services/:id`, `GET /api/me`, `POST /api/bookings` |
| Customer | `GET /api/customer/overview`, `/bookings`, `PATCH /api/customer/bookings/:id/cancel` |
| Vendor | `/api/vendor/overview`, `/services` (GET, POST, PATCH, DELETE), `/bookings` (GET, PATCH) |
| Payments | `POST /api/payments/checkout`, `GET /status`, `POST /cancel-subscription`, `POST /webhook` |
| Admin | `/api/admin/overview`, `/users`, `/users/:id/block`, `/services`, `/services/:id/status`, `/transactions` |

## Deployment

Works on Render/Railway (`npm start`) or Vercel (`vercel.json` included). Set all environment variables, then register the Stripe webhook URL above.