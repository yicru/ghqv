import type { Command } from 'commander';
import { buildObserved, resolveWorkspace } from '../../application/inspect-workspace';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { classifyObserved } from '../../domain/plan';
import { renderStatus } from '../../presentation/console-reporter';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerStatus(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('status')
    .description('Show workspace repository state')
    .option('--check', 'exit non-zero if not all ready')
    .option('--no-git-status', 'skip branch/dirty inspection')
    .action(async (opts: { check?: boolean; noGitStatus?: boolean }) => {
      const ctx = await mkCtx();
      const ws = await resolveWorkspace(ctx, 'status');
      const build = await buildObserved(ctx, ws);
      const branchInfo: { name: string; branch: string; dirty: boolean }[] = [];
      for (const o of build.observed) {
        if (opts.noGitStatus || !o.resolvedSource) {
          branchInfo.push({ name: o.desired.name, branch: '-', dirty: false });
          continue;
        }
        let branch = '-';
        const br = await ctx.git.branch(o.resolvedSource.sourcePath);
        if (br) branch = br;
        else {
          const sh = await ctx.git.shortHead(o.resolvedSource.sourcePath);
          if (sh) branch = `detached:${sh}`;
        }
        const dirty = await ctx.git.isDirty(o.resolvedSource.sourcePath);
        branchInfo.push({ name: o.desired.name, branch, dirty });
      }
      if (ctx.options.json) {
        const data = build.observed.map((o) => ({
          name: o.desired.name,
          state: classifyObserved(o),
          branch: branchInfo.find((b) => b.name === o.desired.name)?.branch ?? '-',
          dirty: branchInfo.find((b) => b.name === o.desired.name)?.dirty ?? false,
          path: o.desired.destinationRelativePath,
          source: o.desired.source,
        }));
        emitJson(okEnvelope('status', { repositories: data }));
      } else {
        ctx.stdout(renderStatus(build.observed, branchInfo));
      }
      if (opts.check) {
        const allOk = build.observed.every((o) => {
          const s = classifyObserved(o);
          return s === 'ready' || s === 'adoptable';
        });
        if (!allOk) throw new GhqvError('GHQV_INTERNAL_ERROR', 'drift detected', EXIT_CODE.DRIFT);
      }
    });
}
