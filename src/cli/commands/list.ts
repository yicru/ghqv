import { join } from 'node:path';
import type { Command } from 'commander';
import { MANIFEST_FILENAME } from '../../domain/manifest';
import { normalizeManifest } from '../../domain/manifest';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import { renderTable } from '../../presentation/table';
import type { CliContext } from '../context';
import { resolveWorkspaceRoot } from '../context';

export function registerList(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('list')
    .description('List workspaces under the workspace root')
    .action(async () => {
      const ctx = await mkCtx();
      const wsRoot = await resolveWorkspaceRoot(ctx);
      let entries: string[] = [];
      try {
        entries = await ctx.fs.readdir(wsRoot);
      } catch {
        entries = [];
      }
      const workspaces: { name: string; path: string; status: string }[] = [];
      for (const name of entries) {
        const dir = join(wsRoot, name);
        const entry = await ctx.fs.lstat(dir);
        if (!entry || entry.kind !== 'directory') continue;
        const hasManifest = await ctx.fs.exists(join(dir, MANIFEST_FILENAME));
        if (!hasManifest) continue;
        let status = 'ok';
        try {
          const { manifest } = await ctx.manifest.read(dir);
          normalizeManifest(manifest);
        } catch {
          status = 'invalid';
        }
        workspaces.push({ name, path: dir, status });
      }
      if (ctx.options.json) {
        emitJson(okEnvelope('list', { workspaces }));
      } else {
        ctx.stdout(
          renderTable(
            [
              { name: 'NAME', width: 24 },
              { name: 'PATH', width: 48 },
              { name: 'STATUS', width: 10 },
            ],
            workspaces.map((w) => [w.name, w.path, w.status]),
          ),
        );
      }
    });
}
