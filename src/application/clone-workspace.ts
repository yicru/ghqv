import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CliContext } from '../cli/context';
import { resolveWorkspaceRoot } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { normalizeManifest } from '../domain/manifest';
import { validateWorkspaceName } from '../domain/workspace';
import { syncWorkspace } from './sync-workspace';

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

export async function cloneWorkspace(
  ctx: CliContext,
  url: string,
  nameOption?: string,
  noSync = false,
): Promise<string> {
  const destName = nameOption ?? deriveName(url);
  validateWorkspaceName(destName);
  const wsRoot = await resolveWorkspaceRoot(ctx);
  const dest = resolve(wsRoot, destName);
  if (await ctx.fs.exists(dest)) {
    throw new GhqvError(
      'GHQV_DESTINATION_CONFLICT',
      `destination already exists: ${dest}`,
      EXIT_CODE.CONFLICT,
    );
  }
  try {
    await ctx.git.clone(url, dest);
  } catch (e) {
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    if (e instanceof GhqvError) {
      throw new GhqvError(e.code, e.message, e.exitCode, {
        hint: e.hint,
        cause: e.cause,
        details: e.details,
      });
    }
    throw new GhqvError(
      'GHQV_EXTERNAL_COMMAND_FAILED',
      `git clone failed: ${redactUrl(url)}`,
      EXIT_CODE.EXTERNAL,
      { cause: e },
    );
  }
  let toplevel: string;
  try {
    toplevel = await ctx.git.topLevel(dest);
  } catch {
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new GhqvError(
      'GHQV_WORKSPACE_INVALID',
      `cloned directory is not a git repository: ${dest}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  const realTop = await ctx.fs.realpath(toplevel);
  const realDest = await ctx.fs.realpath(dest);
  if (realTop !== realDest) {
    throw new GhqvError(
      'GHQV_WORKSPACE_INVALID',
      `cloned directory is not a git top-level: ${dest}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  // manifest validation
  let manifestOk = false;
  try {
    const { manifest } = await ctx.manifest.read(dest);
    normalizeManifest(manifest);
    manifestOk = true;
  } catch (e) {
    ctx.stderr(`error: cloned workspace has invalid manifest; directory left at ${dest}`);
    throw e;
  }
  void manifestOk;
  if (!noSync) {
    try {
      await syncWorkspace(ctx, {
        dryRun: false,
        offline: false,
        noGet: false,
        prune: false,
        repair: false,
      });
    } catch (e) {
      ctx.stderr(`error: sync failed after clone; directory left at ${dest}`);
      throw e;
    }
  }
  return dest;
}

function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').pop() ?? '';
    return seg.replace(/\.git$/, '');
  } catch {
    // scp-style
    const m = url.match(/^[\w.-]+@[^/]+:(.+)$/);
    if (m) {
      const seg = (m[1] ?? '').split('/').pop() ?? '';
      return seg.replace(/\.git$/, '');
    }
    const seg = url.split('/').pop() ?? '';
    return seg.replace(/\.git$/, '');
  }
}

void join;
