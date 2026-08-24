# Iconia AI billing portal

The endpoint `POST /api/billing/portal` creates a Stripe Billing Portal session for the authenticated user's Stripe customer.

It uses `APP_URL` as the return URL, falling back to `https://game-icon-ai.vercel.app`.

The portal can handle subscription management, payment methods, invoices, and cancellation according to the Stripe Billing Portal configuration in the Stripe dashboard.
