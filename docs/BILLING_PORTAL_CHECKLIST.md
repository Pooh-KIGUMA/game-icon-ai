# Billing portal rollout checklist

- Set `STRIPE_SECRET_KEY` in Vercel production.
- Configure Stripe Billing Portal features (subscription changes, payment methods, invoices, cancellation as desired).
- Ensure `APP_URL` points to the production Iconia AI URL.
- Deploy the `billing-portal` branch and test `POST /api/billing/portal` with an authenticated paid account.
