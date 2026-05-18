// Build-stamped identifiers for game logs.
//
// __AI_VERSION__ and __BUILD_TIME__ are injected by Vite at build time via
// the `define` block in vite.config.ts. In Node-based scripts (headless,
// tournament, replay analyzers) that import this module directly without
// going through Vite, the defines aren't available — we fall back to
// reading them dynamically.

declare const __AI_VERSION__: string;
declare const __BUILD_TIME__: string;

/** Git short SHA of the build that produced this code, or 'unknown' if
 *  the build occurred outside a git checkout. Use to stamp game logs so
 *  we can later correlate behavior to specific code versions. */
export const AI_VERSION: string = (typeof __AI_VERSION__ !== 'undefined'
  ? __AI_VERSION__
  : 'dev');

/** ISO timestamp of the build, or 'dev' when running outside a Vite build. */
export const BUILD_TIME: string = (typeof __BUILD_TIME__ !== 'undefined'
  ? __BUILD_TIME__
  : 'dev');
