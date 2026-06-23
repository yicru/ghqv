import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GitClient, StateStore } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { LOCAL_STATE_VERSION, type LocalState, type LocalStateV1 } from '../../domain/local-state';

export class JsonStateStore implements StateStore {
  constructor(private readonly git: GitClient) {}

  async path(workspace: string): Promise<string> {
    return this.git.gitPath(workspace, 'ghqv/state.json');
  }

  async read(workspace: string): Promise<LocalState | null> {
    const p = await this.path(workspace);
    let raw: string;
    try {
      raw = await readFile(p, 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new GhqvError(
        'GHQV_MANIFEST_INVALID',
        `local state parse error: ${(e as Error).message}`,
        EXIT_CODE.USAGE,
        { cause: e },
      );
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== LOCAL_STATE_VERSION) {
      // unknown version: treat as absent, callers should warn
      return null;
    }
    return obj as unknown as LocalStateV1;
  }

  async write(workspace: string, state: LocalState): Promise<void> {
    const p = await this.path(workspace);
    await mkdir(dirname(p), { recursive: true });
    const { writeTextAtomic } = await import('../filesystem/atomic-write');
    await writeTextAtomic(p, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }

  async exists(workspace: string): Promise<boolean> {
    try {
      await readFile(await this.path(workspace), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}
