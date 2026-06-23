import type { Command } from 'commander';
import { diagnose } from '../../application/diagnose';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

export function registerDoctor(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('doctor')
    .description('Diagnose workspace health')
    .option('--fix', 'apply safe automatic fixes')
    .action(async (opts: { fix?: boolean }) => {
      const ctx = await mkCtx();
      const report = await diagnose(ctx, opts.fix === true);
      if (ctx.options.json) {
        emitJson(okEnvelope('doctor', { findings: report.findings }));
      } else {
        for (const f of report.findings) {
          const tag = f.level === 'error' ? 'error' : f.level === 'warning' ? 'warn' : 'ok';
          ctx.stdout(`${tag}: ${f.message}`);
          if (f.hint) ctx.stdout(`  hint: ${f.hint}`);
        }
      }
    });
}
