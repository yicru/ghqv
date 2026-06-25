import type { GhqClient, ProcessRunner } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';

export class GhqProcessClient implements GhqClient {
  constructor(private readonly runner: ProcessRunner) {}

  async version(): Promise<string> {
    const r = await this.runner.run({ command: 'ghq', args: ['--version'], output: 'capture' });
    return r.stdout.trim();
  }

  async roots(): Promise<string[]> {
    const r = await this.runner.run({ command: 'ghq', args: ['root'], output: 'capture' });
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async resolveExact(source: string): Promise<string[]> {
    const r = await this.runner.run({
      command: 'ghq',
      args: ['list', '--full-path', '--exact', source],
      output: 'capture',
    });
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async list(): Promise<string[]> {
    const r = await this.runner.run({
      command: 'ghq',
      args: ['list'],
      output: 'capture',
    });
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async get(source: string, _options: { interactive: boolean }): Promise<void> {
    try {
      await this.runner.run({
        command: 'ghq',
        args: ['get', source],
        output: 'inherit',
        stdin: 'ignore',
      });
    } catch (e) {
      if (e instanceof GhqvError) throw e;
      throw new GhqvError(
        'GHQV_EXTERNAL_COMMAND_FAILED',
        `ghq get failed for ${source}`,
        EXIT_CODE.EXTERNAL,
        { cause: e },
      );
    }
  }
}
