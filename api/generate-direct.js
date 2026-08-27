// Direct generation endpoint used by the main app.
// It intentionally reuses the proven credit + generation handler while
// bypassing the previous rewrite target for /api/generate.
export { default } from './generate-fast.js';
