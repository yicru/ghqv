declare const GHQV_VERSION: string;
declare const GHQV_COMMIT: string;
declare const GHQV_BUILD_DATE: string;

// Build-time constants injected via Bun.build define(). Fallbacks for dev runs.
export const VERSION: string = typeof GHQV_VERSION !== 'undefined' ? GHQV_VERSION : '0.0.0-dev';
export const COMMIT: string = typeof GHQV_COMMIT !== 'undefined' ? GHQV_COMMIT : 'unknown';
export const BUILD_DATE: string =
  typeof GHQV_BUILD_DATE !== 'undefined' ? GHQV_BUILD_DATE : 'unknown';
