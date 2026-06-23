import type { Command } from 'commander';
import { removeRepository } from '../../application/edit-manifest';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerRemove(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('remove')
    .description('Remove a repository from the workspace manifest')
    .argument('<name>', 'logical repository name')
    .option('--force', 'remove even if other repositories depend on it')
    .action(async (name: string, opts: { force?: boolean }) => {
      const ctx = await mkCtx();
      await removeRepository(ctx, name, opts.force === true);
      if (ctx.options.json) {
        emitJson(okEnvelope('remove', { name }));
      } else {
        ctx.stdout(`Removed ${name}. Run \`ghqv sync --prune\` to delete the link.`);
      }
    });
}
