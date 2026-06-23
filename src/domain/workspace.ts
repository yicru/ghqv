import { resolve } from 'node:path';
import { EXIT_CODE, GhqvError } from './errors';

const WS_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidWorkspaceName(name: string): boolean {
  return WS_NAME_RE.test(name);
}

export function validateWorkspaceName(name: string): void {
  if (!isValidWorkspaceName(name)) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      `invalid workspace name: ${JSON.stringify(name)}`,
      EXIT_CODE.USAGE,
      { hint: `Must match ${WS_NAME_RE.source}.` },
    );
  }
}

/**
 * Resolve a --workspace argument into an absolute path.
 * - absolute path -> used as-is
 * - starts with ./ or ../ -> resolved from cwd
 * - otherwise -> treated as a workspace name under workspaceRoot
 */
export function resolveWorkspaceArg(arg: string, workspaceRoot: string, cwd: string): string {
  if (arg.startsWith('/')) return arg;
  if (arg.startsWith('./') || arg.startsWith('../')) {
    return resolve(cwd, arg);
  }
  validateWorkspaceName(arg);
  return resolve(workspaceRoot, arg);
}

export function expandHome(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return resolve(home, input.slice(2));
  return input;
}
