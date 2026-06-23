import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type IntegrationEnv, createRemoteBare, preCheckout, setupEnv } from './helpers';
import { runGhqv } from './run';

let env: IntegrationEnv;
beforeAll(async () => {
  env = await setupEnv();
  await createRemoteBare(env, 'github.com/org-a/backend');
  preCheckout(env, 'github.com/org-a/backend');
});
afterAll(async () => {
  await env.cleanup();
});

describe('safety', () => {
  it('does not overwrite a regular file', async () => {
    await runGhqv(env.env, ['init', 'safe-ws']);
    await runGhqv(env.env, ['-w', 'safe-ws', 'add', 'github.com/org-a/backend', '--as', 'backend']);
    // pre-create a regular file at the destination
    await writeFile(join(env.workspaces, 'safe-ws', 'backend'), 'user content');
    const r = await runGhqv(env.env, ['-w', 'safe-ws', 'sync']);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('occupied');
  });

  it('does not run ghq get with --no-get', async () => {
    await runGhqv(env.env, ['init', 'noget-ws']);
    // a source that is NOT checked out
    await createRemoteBare(env, 'github.com/org-c/billing');
    await runGhqv(env.env, [
      '-w',
      'noget-ws',
      'add',
      'github.com/org-c/billing',
      '--as',
      'billing',
    ]);
    const r = await runGhqv(env.env, ['-w', 'noget-ws', 'sync', '--no-get']);
    expect(r.exitCode).toBe(0);
    // link should NOT have been created because source missing and no get
    expect(r.stdout).toContain('GET');
  });

  it('prunes state-owned removed links', async () => {
    await runGhqv(env.env, ['init', 'prune-ws']);
    await runGhqv(env.env, [
      '-w',
      'prune-ws',
      'add',
      'github.com/org-a/backend',
      '--as',
      'backend',
    ]);
    await runGhqv(env.env, ['-w', 'prune-ws', 'sync']);
    await runGhqv(env.env, ['-w', 'prune-ws', 'remove', 'backend', '--force']);
    const r = await runGhqv(env.env, ['-w', 'prune-ws', 'sync', '--prune']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('UNLINK');
  });

  it('rejects path traversal in manifest path', async () => {
    await runGhqv(env.env, ['init', 'trav-ws']);
    const r = await runGhqv(env.env, [
      '-w',
      'trav-ws',
      'add',
      'github.com/org-a/backend',
      '--as',
      'b',
      '--path',
      '../escape',
    ]);
    expect(r.exitCode).toBe(2);
  });

  it('list shows workspaces', async () => {
    const r = await runGhqv(env.env, ['list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('safe-ws');
  });

  it('path prints absolute path', async () => {
    const r = await runGhqv(env.env, ['path', 'safe-ws']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(join(env.workspaces, 'safe-ws'));
  });
});
