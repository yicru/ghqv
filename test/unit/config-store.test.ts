import { describe, expect, it } from 'bun:test';
import type { ProcessRequest, ProcessResult, ProcessRunner } from '../../src/application/ports';
import { GitConfigStore } from '../../src/infrastructure/config/git-config-store';

function fakeRunner(result: Partial<ProcessResult>): ProcessRunner {
  return {
    async run(_req: ProcessRequest): Promise<ProcessResult> {
      return {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        ...result,
      };
    },
  };
}

describe('GitConfigStore.getWorkspaceRoot', () => {
  it('returns null when the git config key is absent (exit 1)', async () => {
    const store = new GitConfigStore(fakeRunner({ exitCode: 1, stdout: '', stderr: '' }), '/h');
    expect(await store.getWorkspaceRoot()).toBeNull();
  });
  it('returns the value when set', async () => {
    const store = new GitConfigStore(fakeRunner({ exitCode: 0, stdout: '/some/path\n' }), '/h');
    expect(await store.getWorkspaceRoot()).toBe('/some/path');
  });
});
