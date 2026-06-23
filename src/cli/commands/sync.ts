import type { Command } from 'commander';
import { type SyncOptions, syncWorkspace } from '../../application/sync-workspace';
import { renderSyncPlan } from '../../presentation/console-reporter';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerSync(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('sync')
    .description('Materialize manifest repositories as symlinks')
    .option('--dry-run', 'show plan without applying changes')
    .option('--offline', 'forbid network acquisition (implies --no-get)')
    .option('--no-get', 'do not run ghq get for missing sources')
    .option('--prune', 'remove state-owned links for removed repositories')
    .option('--repair', 'replace state-owned wrong or broken links')
    .action(
      async (opts: {
        dryRun?: boolean;
        offline?: boolean;
        get?: boolean;
        prune?: boolean;
        repair?: boolean;
      }) => {
        const ctx = await mkCtx();
        const syncOpts: SyncOptions = {
          dryRun: opts.dryRun === true,
          offline: opts.offline === true,
          noGet: opts.get === false,
          prune: opts.prune === true,
          repair: opts.repair === true,
        };
        const outcome = await syncWorkspace(ctx, syncOpts);
        if (ctx.options.json) {
          emitJson(
            okEnvelope('sync', {
              dryRun: syncOpts.dryRun,
              actions: outcome.plan.actions.map((a) => a.type),
              conflicts: outcome.plan.conflicts.map((c) =>
                c.type === 'conflict' ? c.code : c.type,
              ),
              stateWritten: outcome.stateWritten,
            }),
          );
        } else {
          ctx.stdout(renderSyncPlan(outcome.plan.actions, ctx.colors));
          if (outcome.plan.conflicts.length > 0) {
            ctx.stderr(`${outcome.plan.conflicts.length} conflict(s) detected`);
          }
        }
      },
    );
}
