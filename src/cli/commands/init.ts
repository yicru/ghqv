import type { Command } from 'commander';
import { initWorkspace } from '../../application/init-workspace';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerInit(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('init')
    .description('Create a new virtual workspace')
    .argument('<name>', "workspace name or '.' for current directory")
    .option('--description <text>', 'workspace description')
    .action(async (name: string, opts: { description?: string }) => {
      const ctx = await mkCtx();
      const path = await initWorkspace(ctx, name, opts.description);
      if (ctx.options.json) {
        emitJson(okEnvelope('init', { path }));
      } else {
        ctx.stdout(path);
      }
    });
}
