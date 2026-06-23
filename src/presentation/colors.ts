import picocolors from 'picocolors';

export type ColorMode = 'auto' | 'always' | 'never';

export interface Colors {
  enabled: boolean;
  bold: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
}

export function createColors(mode: ColorMode, isTty: boolean): Colors {
  const enabled = mode === 'always' || (mode === 'auto' && isTty);
  if (enabled) {
    return {
      enabled,
      bold: (s) => picocolors.bold(s),
      green: (s) => picocolors.green(s),
      yellow: (s) => picocolors.yellow(s),
      red: (s) => picocolors.red(s),
      cyan: (s) => picocolors.cyan(s),
      dim: (s) => picocolors.dim(s),
    };
  }
  const identity = (s: string) => s;
  return {
    enabled,
    bold: identity,
    green: identity,
    yellow: identity,
    red: identity,
    cyan: identity,
    dim: identity,
  };
}
