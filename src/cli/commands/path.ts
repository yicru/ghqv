import { join } from 'node:path';
import type { Command } from 'commander';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { MANIFEST_FILENAME } from '../../domain/manifest';
import { isValidWorkspaceName, resolveWorkspaceArg } from '../../domain/workspace';
import type { CliContext } from '../context';
import { resolveWorkspaceRoot } from '../context';

export function registerPath(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('path')
    .description('Print the absolute path of a workspace')
    .argument('<name>', 'workspace name')
    .action(async (name: string) => {
      const ctx = await mkCtx();
      const wsRoot = await resolveWorkspaceRoot(ctx);
      const wsPath = isValidWorkspaceName(name)
        ? join(wsRoot, name)
        : resolveWorkspaceArg(name, wsRoot, ctx.cwd);
      const exists =
        (await ctx.fs.exists(wsPath)) && (await ctx.fs.exists(join(wsPath, MANIFEST_FILENAME)));
      if (!exists) {
        throw new GhqvError(
          'GHQV_WORKSPACE_NOT_FOUND',
          `workspace not found: ${name}`,
          EXIT_CODE.NOT_FOUND,
        );
      }
      ctx.stdout(wsPath);
    });
}
