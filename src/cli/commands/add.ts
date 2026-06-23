import type { Command } from 'commander';
import { addRepository } from '../../application/edit-manifest';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerAdd(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('add')
    .description('Add a repository to the workspace manifest')
    .argument('<source>', 'canonical source host/namespace/repository')
    .option('--as <name>', 'logical repository name')
    .option('--path <path>', 'workspace-relative path')
    .option('--role <text>', 'repository role')
    .option('--tech <names...>', 'technology tags')
    .option('--depends-on <names...>', 'logical names this repository depends on')
    .action(
      async (
        source: string,
        opts: { as?: string; path?: string; role?: string; tech?: string[]; dependsOn?: string[] },
      ) => {
        const ctx = await mkCtx();
        await addRepository(ctx, {
          source,
          as: opts.as,
          path: opts.path,
          role: opts.role,
          tech: opts.tech,
          dependsOn: opts.dependsOn,
        });
        if (ctx.options.json) {
          emitJson(okEnvelope('add', { source, as: opts.as }));
        } else {
          ctx.stdout(`Added ${opts.as ?? source}. Run \`ghqv sync\` to materialize.`);
        }
      },
    );
}
