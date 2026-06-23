import { resolve } from 'node:path';
import type {
  ConfigStore,
  FileSystem,
  GhqClient,
  GitClient,
  LockManager,
  ManifestStore,
  ProcessRunner,
  StateStore,
} from '../application/ports';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { expandHome } from '../domain/workspace';
import { type Colors, createColors } from '../presentation/colors';
import type { GlobalOptions } from './options';

export interface CliContext {
  options: GlobalOptions;
  fs: FileSystem;
  process: ProcessRunner;
  ghq: GhqClient;
  git: GitClient;
  manifest: ManifestStore;
  state: StateStore;
  lock: LockManager;
  config: ConfigStore;
  colors: Colors;
  home: string;
  cwd: string;
  stderr: (msg: string) => void;
  stdout: (msg: string) => void;
}

export async function resolveWorkspaceRoot(ctx: CliContext): Promise<string> {
  if (ctx.options.workspaceRoot) {
    const expanded = expandHome(ctx.options.workspaceRoot, ctx.home);
    if (!expanded.startsWith('/')) {
      throw new GhqvError(
        'GHQV_USAGE_ERROR',
        'workspace root must be an absolute path',
        EXIT_CODE.USAGE,
      );
    }
    return resolve(expanded);
  }
  const envRoot = process.env.GHQV_WORKSPACE_ROOT;
  if (envRoot) {
    const expanded = expandHome(envRoot, ctx.home);
    if (!expanded.startsWith('/')) {
      throw new GhqvError(
        'GHQV_USAGE_ERROR',
        'GHQV_WORKSPACE_ROOT must be absolute',
        EXIT_CODE.USAGE,
      );
    }
    return resolve(expanded);
  }
  const gitRoot = await ctx.config.getWorkspaceRoot();
  if (gitRoot) {
    const expanded = expandHome(gitRoot, ctx.home);
    return resolve(expanded);
  }
  return resolve(ctx.home, 'ghq', 'workspaces');
}
