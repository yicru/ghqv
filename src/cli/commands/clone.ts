import type { Command } from 'commander';
import { cloneWorkspace } from '../../application/clone-workspace';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerClone(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('clone')
    .description('Clone a shared workspace repository into the workspace root')
    .argument('<url>', 'repository URL')
    .option('--name <workspace-name>', 'destination workspace name')
    .option('--no-sync', 'do not run sync after clone')
    .action(async (url: string, opts: { name?: string; sync?: boolean }) => {
      const ctx = await mkCtx();
      const path = await cloneWorkspace(ctx, url, opts.name, opts.sync === false);
      if (ctx.options.json) {
        emitJson(okEnvelope('clone', { path }));
      } else {
        ctx.stdout(path);
      }
    });
}
