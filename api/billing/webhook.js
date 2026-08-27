// Compatibility route for the Stripe endpoint configured as /api/billing/webhook.
// The implementation lives in ../webhook.js so both paths use the same verified handler.
export { default, config } from '../webhook.js';
