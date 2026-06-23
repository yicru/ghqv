import { resolve } from 'node:path';
import type { ConfigStore, ProcessRunner } from '../../application/ports';
import { expandHome } from '../../domain/workspace';

export class GitConfigStore implements ConfigStore {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly home: string,
  ) {}

  async getWorkspaceRoot(): Promise<string | null> {
    const r = await this.runner.run({
      command: 'git',
      args: ['config', '--global', 'ghqv.workspaceRoot'],
      output: 'capture',
    });
    const v = r.stdout.trim();
    return v.length === 0 ? null : v;
  }

  async setWorkspaceRoot(p: string): Promise<void> {
    const expanded = expandHome(p, this.home);
    const abs = resolve(expanded);
    await this.runner.run({
      command: 'git',
      args: ['config', '--global', 'ghqv.workspaceRoot', abs],
      output: 'capture',
    });
  }

  async unsetWorkspaceRoot(): Promise<void> {
    // ignore failure when key absent
    try {
      await this.runner.run({
        command: 'git',
        args: ['config', '--global', '--unset', 'ghqv.workspaceRoot'],
        output: 'capture',
      });
    } catch {
      // ignore
    }
  }
}
