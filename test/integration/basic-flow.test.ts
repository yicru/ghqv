import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type IntegrationEnv, createRemoteBare, preCheckout, setupEnv } from './helpers';
import { runGhqv } from './run';

let env: IntegrationEnv;

beforeAll(async () => {
  env = await setupEnv();
  await createRemoteBare(env, 'github.com/org-a/backend');
  await createRemoteBare(env, 'github.com/org-b/frontend');
  preCheckout(env, 'github.com/org-a/backend');
  preCheckout(env, 'github.com/org-b/frontend');
});

afterAll(async () => {
  await env.cleanup();
});

describe('basic flow', () => {
  it('init creates workspace files', async () => {
    const r = await runGhqv(env.env, ['init', 'myws', '--description', 'test']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(join(env.workspaces, 'myws'));
  });

  it('add registers repositories', async () => {
    const a = await runGhqv(env.env, [
      '-w',
      'myws',
      'add',
      'github.com/org-a/backend',
      '--as',
      'backend',
      '--role',
      'Backend API',
      '--tech',
      'TypeScript',
    ]);
    expect(a.exitCode).toBe(0);
    const b = await runGhqv(env.env, [
      '-w',
      'myws',
      'add',
      'github.com/org-b/frontend',
      '--as',
      'frontend',
      '--role',
      'Web frontend',
      '--tech',
      'TypeScript',
      'React',
      '--depends-on',
      'backend',
    ]);
    expect(b.exitCode).toBe(0);
  });

  it('sync dry-run shows plan', async () => {
    const r = await runGhqv(env.env, ['-w', 'myws', 'sync', '--dry-run']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('LINK');
  });

  it('sync materializes symlinks', async () => {
    const r = await runGhqv(env.env, ['-w', 'myws', 'sync']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('LINK');
  });

  it('status shows ready', async () => {
    const r = await runGhqv(env.env, ['-w', 'myws', 'status']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ready');
  });

  it('second sync is idempotent (NOOP)', async () => {
    const r = await runGhqv(env.env, ['-w', 'myws', 'sync']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('NOOP');
  });

  it('status --json is valid JSON', async () => {
    const r = await runGhqv(env.env, ['-w', 'myws', 'status', '--json']);
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.ok).toBe(true);
    expect(obj.command).toBe('status');
  });
});

function join(...parts: string[]): string {
  // local join to avoid importing node:path at top for brevity
  return parts.join('/');
}
