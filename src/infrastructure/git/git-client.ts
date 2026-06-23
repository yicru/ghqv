import { isAbsolute, resolve } from 'node:path';
import type { GitClient, ProcessRunner } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';

export class GitProcessClient implements GitClient {
  constructor(private readonly runner: ProcessRunner) {}

  async init(path: string): Promise<void> {
    await this.runner.run({
      command: 'git',
      args: ['init', path],
      output: 'capture',
      stdin: 'ignore',
    });
  }

  async clone(url: string, destination: string, options?: { signal?: AbortSignal }): Promise<void> {
    await this.runner.run({
      command: 'git',
      args: ['clone', url, destination],
      output: 'inherit',
      stdin: 'ignore',
      signal: options?.signal,
    });
  }

  async topLevel(path: string): Promise<string> {
    const r = await this.runner.run({
      command: 'git',
      args: ['-C', path, 'rev-parse', '--show-toplevel'],
      output: 'capture',
    });
    return r.stdout.trim();
  }

  async isBare(path: string): Promise<boolean> {
    try {
      const r = await this.runner.run({
        command: 'git',
        args: ['-C', path, 'rev-parse', '--is-bare-repository'],
        output: 'capture',
      });
      return r.stdout.trim() === 'true';
    } catch {
      throw new GhqvError(
        'GHQV_SOURCE_INVALID',
        `not a git repository: ${path}`,
        EXIT_CODE.EXTERNAL,
      );
    }
  }

  async gitPath(workspace: string, relativePath: string): Promise<string> {
    const r = await this.runner.run({
      command: 'git',
      args: ['-C', workspace, 'rev-parse', '--git-path', relativePath],
      output: 'capture',
    });
    const p = r.stdout.trim();
    return isAbsolute(p) ? p : resolve(workspace, p);
  }

  async branch(path: string): Promise<string | null> {
    try {
      const r = await this.runner.run({
        command: 'git',
        args: ['-C', path, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
        output: 'capture',
      });
      const out = r.stdout.trim();
      return out.length === 0 ? null : out;
    } catch {
      return null;
    }
  }

  async shortHead(path: string): Promise<string | null> {
    try {
      const r = await this.runner.run({
        command: 'git',
        args: ['-C', path, 'rev-parse', '--short', 'HEAD'],
        output: 'capture',
      });
      const out = r.stdout.trim();
      return out.length === 0 ? null : out;
    } catch {
      return null;
    }
  }

  async isDirty(path: string): Promise<boolean> {
    const r = await this.runner.run({
      command: 'git',
      args: ['-C', path, 'status', '--porcelain=v1'],
      output: 'capture',
    });
    return r.stdout.trim().length > 0;
  }
}
