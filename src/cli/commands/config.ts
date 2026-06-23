import type { Command } from 'commander';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';
import { resolveWorkspaceRoot } from '../context';

export function registerConfig(program: Command, mkCtx: () => Promise<CliContext>): void {
  const configCmd = program.command('config').description('Manage ghqv configuration');
  configCmd
    .command('list')
    .description('List configuration values')
    .action(async () => {
      const ctx = await mkCtx();
      const root = await resolveWorkspaceRoot(ctx);
      if (ctx.options.json) {
        emitJson(okEnvelope('config', { 'workspace-root': root }));
      } else {
        ctx.stdout(`workspace-root=${root}`);
      }
    });
  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action(async (key: string) => {
      const ctx = await mkCtx();
      if (key === 'workspace-root') {
        const root = await resolveWorkspaceRoot(ctx);
        if (ctx.options.json) emitJson(okEnvelope('config', { key, value: root }));
        else ctx.stdout(root);
      } else {
        throw new GhqvError('GHQV_USAGE_ERROR', `unknown config key: ${key}`, EXIT_CODE.USAGE);
      }
    });
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
      const ctx = await mkCtx();
      if (key === 'workspace-root') {
        await ctx.config.setWorkspaceRoot(value);
        if (ctx.options.json) emitJson(okEnvelope('config', { key, value }));
        else ctx.stdout(`set ${key}=${value}`);
      } else {
        throw new GhqvError('GHQV_USAGE_ERROR', `unknown config key: ${key}`, EXIT_CODE.USAGE);
      }
    });
  configCmd
    .command('unset <key>')
    .description('Unset a configuration value')
    .action(async (key: string) => {
      const ctx = await mkCtx();
      if (key === 'workspace-root') {
        await ctx.config.unsetWorkspaceRoot();
        if (ctx.options.json) emitJson(okEnvelope('config', { key, unset: true }));
        else ctx.stdout(`unset ${key}`);
      } else {
        throw new GhqvError('GHQV_USAGE_ERROR', `unknown config key: ${key}`, EXIT_CODE.USAGE);
      }
    });
}
