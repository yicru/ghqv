import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import type { LockHandle, LockInfo, LockManager } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class FileLockManager implements LockManager {
  private currentHost = hostname();

  async acquire(workspace: string, info: LockInfo): Promise<LockHandle> {
    const lockPath = await this.lockPath(workspace);
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await writeFile(handle, JSON.stringify(info, null, 2), 'utf8');
      await handle.close();
    } catch (e) {
      const existing = await this.current(workspace);
      if (existing) {
        if (existing.hostname === this.currentHost && isPidAlive(existing.pid)) {
          throw new GhqvError(
            'GHQV_LOCKED',
            `workspace is locked by another process (pid ${existing.pid}, command ${existing.command})`,
            EXIT_CODE.LOCKED,
            {
              hint: 'Wait for the other process to finish, or run `ghqv doctor --fix` if it is stale.',
            },
          );
        }
        // stale or remote: refuse to auto-remove in some cases; allow acquire by overwriting only if stale on same host
        if (existing.hostname === this.currentHost && !isPidAlive(existing.pid)) {
          await unlink(lockPath).catch(() => {});
          await mkdir(dirname(lockPath), { recursive: true });
          const handle = await open(lockPath, 'wx', 0o600);
          await writeFile(handle, JSON.stringify(info, null, 2), 'utf8');
          await handle.close();
        } else {
          throw new GhqvError(
            'GHQV_LOCKED',
            `workspace is locked (pid ${existing.pid}, host ${existing.hostname}). Possible shared filesystem.`,
            EXIT_CODE.LOCKED,
            {
              hint: 'Run `ghqv doctor --fix` to remove a stale lock, or remove it manually if safe.',
            },
          );
        }
      } else {
        throw e;
      }
    }
    return {
      release: async () => {
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
      },
    };
  }

  async current(workspace: string): Promise<LockInfo | null> {
    const lockPath = await this.lockPath(workspace);
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(lockPath, 'utf8');
      return JSON.parse(raw) as LockInfo;
    } catch {
      return null;
    }
  }

  async removeStale(workspace: string): Promise<boolean> {
    const existing = await this.current(workspace);
    if (!existing) return false;
    if (existing.hostname === this.currentHost && !isPidAlive(existing.pid)) {
      const lockPath = await this.lockPath(workspace);
      await unlink(lockPath).catch(() => {});
      return true;
    }
    return false;
  }

  private lockPathCache = new Map<string, string>();

  async lockPath(workspace: string): Promise<string> {
    // Avoid circular dependency on GitClient: callers pass the resolved git-path-based lock location
    // via a setter. For simplicity here we use `<workspace>/.git/ghqv/lock` fallback.
    const cached = this.lockPathCache.get(workspace);
    if (cached) return cached;
    return `${workspace}/.git/ghqv/lock`;
  }

  setLockPath(workspace: string, absolutePath: string): void {
    this.lockPathCache.set(workspace, absolutePath);
  }

  setStatePath(workspace: string, absolutePath: string): void {
    this.statePathCache.set(workspace, absolutePath);
  }

  private statePathCache = new Map<string, string>();

  async statePath(workspace: string): Promise<string> {
    const cached = this.statePathCache.get(workspace);
    if (cached) return cached;
    return `${workspace}/.git/ghqv/state.json`;
  }
}
