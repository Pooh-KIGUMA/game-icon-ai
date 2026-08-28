// Compatibility endpoint for the main image generation route.
// Reuses the existing fast generation handler without adding another Vercel function.
export { default } from './generate-fast.js';
