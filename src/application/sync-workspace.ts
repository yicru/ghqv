import { hostname } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { VERSION } from '../build-info';
import type { CliContext } from '../cli/context';
import { resolveWorkspaceRoot } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { type LocalState, emptyLocalState } from '../domain/local-state';
import { type NormalizedManifest, manifestDigest } from '../domain/manifest';
import { type PlanAction, type SyncPlan, buildPlan, managedDirectoriesFor } from '../domain/plan';
import type {
  ManagedRepositoryState,
  ObservedRepository,
  ResolvedRepository,
} from '../domain/repository';
import { regenerateManagedFiles } from './init-workspace';
import { buildObserved, resolveWorkspace } from './inspect-workspace';

export interface SyncOptions {
  dryRun: boolean;
  offline: boolean;
  noGet: boolean;
  prune: boolean;
  repair: boolean;
}

export interface SyncOutcome {
  plan: SyncPlan;
  applied: PlanAction[];
  stateWritten: boolean;
}

export async function syncWorkspace(ctx: CliContext, opts: SyncOptions): Promise<SyncOutcome> {
  const ws = await resolveWorkspace(ctx, 'sync');
  const wsRoot = await resolveWorkspaceRoot(ctx);
  void wsRoot;
  const wsReal = await ctx.fs.realpath(ws.path);

  // lock
  const lockInfo = {
    version: 1 as const,
    pid: process.pid,
    hostname: hostname(),
    command: 'sync',
    startedAt: new Date().toISOString(),
    ghqvVersion: VERSION,
  };
  const lockPath = await ctx.git.gitPath(ws.path, 'ghqv/lock');
  if ('setLockPath' in ctx.lock) (ctx.lock as any).setLockPath(ws.path, lockPath);
  const lockHandle = await ctx.lock.acquire(ws.path, lockInfo);

  try {
    return await doSync(ctx, ws, wsReal, opts);
  } finally {
    await lockHandle.release();
  }
}

async function doSync(
  ctx: CliContext,
  ws: { path: string; manifest: NormalizedManifest; rawManifestContent: string },
  wsReal: string,
  opts: SyncOptions,
): Promise<SyncOutcome> {
  const noGet = opts.noGet || opts.offline;

  // preflight destination paths
  for (const r of ws.manifest.repositories) {
    validateDestinationSafe(ws.path, r.path);
  }

  const build = await buildObserved(ctx, ws);
  let observed = build.observed;

  // acquisition plan
  const toGet = observed.filter((o) => !o.resolvedSource);
  const gets: { type: 'get'; repository: import('../domain/repository').DesiredRepository }[] = [];
  if (!noGet && ws.manifest.workspace.autoGet) {
    for (const o of toGet) {
      gets.push({ type: 'get', repository: o.desired });
    }
  }

  if (opts.dryRun) {
    const plan = await buildFinalPlan(ctx, ws, wsReal, opts, observed);
    // include get actions in display
    plan.actions = [...gets, ...plan.actions];
    return { plan, applied: [], stateWritten: false };
  }

  // execute gets sequentially
  for (const g of gets) {
    await ctx.ghq.get(g.repository.source, { interactive: !ctx.options.json });
  }

  // re-resolve
  observed = (await buildObserved(ctx, ws)).observed;

  const plan = await buildFinalPlan(ctx, ws, wsReal, opts, observed);

  if (plan.conflicts.length > 0) {
    const c = plan.conflicts[0];
    if (c && c.type === 'conflict') {
      throw new GhqvError(
        (c.code as GhqvError['code']) ?? 'GHQV_DESTINATION_CONFLICT',
        c.message,
        EXIT_CODE.CONFLICT,
        { details: { name: c.name } },
      );
    }
  }

  const applied: PlanAction[] = [];
  const createdLinks: string[] = [];
  const createdDirs: string[] = [];
  const writtenFiles: { path: string; prev: string | null }[] = [];

  for (const action of plan.actions) {
    applied.push(action);
    switch (action.type) {
      case 'mkdir': {
        const abs = join(ws.path, action.relativePath);
        await ctx.fs.mkdirAll(abs);
        createdDirs.push(abs);
        break;
      }
      case 'link': {
        await ensureParentDir(ctx, ws.path, action.repository.destinationRelativePath, createdDirs);
        const dest = join(ws.path, action.repository.destinationRelativePath);
        await preflightDestination(ctx, wsReal, dest);
        await ctx.fs.symlink(action.linkTarget, dest);
        createdLinks.push(dest);
        break;
      }
      case 'adopt':
        // nothing to write to FS; just record for state
        break;
      case 'relink': {
        const dest = join(ws.path, action.repository.destinationRelativePath);
        // re-verify ownership
        const entry = await ctx.fs.lstat(dest);
        if (!entry || entry.kind !== 'symlink') {
          throw new GhqvError(
            'GHQV_DESTINATION_CONFLICT',
            `expected symlink at ${dest}`,
            EXIT_CODE.CONFLICT,
          );
        }
        await ctx.fs.unlink(dest);
        try {
          await ctx.fs.symlink(action.linkTarget, dest);
        } catch (e) {
          // best-effort restore
          try {
            await ctx.fs.symlink(action.previousTarget, dest);
          } catch {
            // ignore
          }
          throw e;
        }
        break;
      }
      case 'unlink': {
        const dest = join(ws.path, action.relativePath);
        const entry = await ctx.fs.lstat(dest);
        if (!entry || entry.kind !== 'symlink') break;
        const current = await ctx.fs.readlink(dest);
        if (current !== action.expectedTarget) {
          // realpath compare
          try {
            const rp = await ctx.fs.realpath(dest);
            if (rp !== action.expectedTarget) break;
          } catch {
            break;
          }
        }
        await ctx.fs.unlink(dest);
        break;
      }
      case 'rmdir': {
        const abs = join(ws.path, action.relativePath);
        const entry = await ctx.fs.lstat(abs);
        if (entry && entry.kind === 'directory') {
          const children = await ctx.fs.readdir(abs);
          if (children.length === 0) {
            await ctx.fs.rmdir(abs);
          }
        }
        break;
      }
      case 'write': {
        const abs = join(ws.path, action.relativePath);
        const prev = (await ctx.fs.exists(abs)) ? await ctx.fs.readText(abs) : null;
        writtenFiles.push({ path: abs, prev });
        await ctx.fs.writeTextAtomic(abs, action.content, 0o644);
        break;
      }
      case 'noop':
      case 'get':
        break;
      case 'conflict':
        // shouldn't reach here (conflicts block earlier)
        break;
    }
  }

  // managed files
  const managed = await regenerateManagedFiles(ctx, ws.path, ws.manifest);

  // re-observe after applying actions so state reflects the new links
  const postObserved = (await buildObserved(ctx, ws)).observed;
  const newState = await composeState(ctx, ws, postObserved);
  await ctx.state.write(ws.path, newState);

  void createdLinks;
  void createdDirs;
  void writtenFiles;
  void managedDirectoriesFor;
  void manifestDigest;

  return { plan, applied, stateWritten: true };
}

async function composeState(
  ctx: CliContext,
  ws: { path: string; manifest: NormalizedManifest; rawManifestContent: string },
  observed: ObservedRepository[],
): Promise<LocalState> {
  const repos: Record<string, ManagedRepositoryState> = {};
  for (const o of observed) {
    if (!o.resolvedSource) continue;
    if (
      o.destinationKind === 'symlink' &&
      o.resolvedLinkTarget === o.resolvedSource.sourceRealPath
    ) {
      repos[o.desired.name] = {
        source: o.desired.source,
        path: o.desired.destinationRelativePath,
        mode: o.desired.mode,
        resolvedSourcePath: o.resolvedSource.sourcePath,
        linkTarget: await computeStateLinkTarget(
          ctx,
          ws.path,
          o.desired.destinationRelativePath,
          o.resolvedSource.sourceRealPath,
        ),
      };
    }
  }
  const managedDirs = managedDirectoriesFor(ws.manifest).filter((d) =>
    ws.manifest.repositories.some((r) => r.path.startsWith(`${d}/`)),
  );
  const state = emptyLocalState(VERSION, manifestDigest(ws.rawManifestContent));
  state.repositories = repos;
  state.managedDirectories = managedDirs;
  return state;
}

async function computeStateLinkTarget(
  ctx: CliContext,
  wsPath: string,
  relPath: string,
  sourceRealPath: string,
): Promise<string> {
  const destDirReal = await ctx.fs.realpath(dirname(join(wsPath, relPath)));
  return relative(destDirReal, sourceRealPath);
}

async function buildFinalPlan(
  ctx: CliContext,
  ws: { path: string; manifest: NormalizedManifest },
  _wsReal: string,
  opts: SyncOptions,
  observed: ObservedRepository[],
): Promise<SyncPlan> {
  const state = (await ctx.state.read(ws.path)) ?? emptyLocalState(VERSION, '');
  const plan = buildPlan({
    observed,
    state,
    manifest: ws.manifest,
    options: { prune: opts.prune, repair: opts.repair },
  });
  return plan;
}

async function ensureParentDir(
  ctx: CliContext,
  wsPath: string,
  relPath: string,
  created: string[],
): Promise<void> {
  const segs = relPath.split('/');
  let cur = wsPath;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = join(cur, segs[i]!);
    if (!(await ctx.fs.exists(cur))) {
      await ctx.fs.mkdirAll(cur);
      created.push(cur);
    }
  }
}

function validateDestinationSafe(wsPath: string, relPath: string): void {
  const dest = resolve(wsPath, relPath);
  if (!dest.startsWith(`${wsPath}${sep}`) && dest !== wsPath) {
    throw new GhqvError(
      'GHQV_DESTINATION_CONFLICT',
      `destination escapes workspace: ${relPath}`,
      EXIT_CODE.CONFLICT,
    );
  }
}

async function preflightDestination(ctx: CliContext, wsReal: string, dest: string): Promise<void> {
  // ensure no ancestor symlink escapes workspace
  let cur = dest;
  while (cur !== wsReal && cur.length >= wsReal.length) {
    const entry = await ctx.fs.lstat(cur);
    if (entry && entry.kind === 'symlink') {
      throw new GhqvError(
        'GHQV_DESTINATION_CONFLICT',
        `ancestor path is a symlink: ${cur}`,
        EXIT_CODE.CONFLICT,
      );
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const destEntry = await ctx.fs.lstat(dest);
  if (destEntry) {
    throw new GhqvError(
      'GHQV_DESTINATION_CONFLICT',
      `destination already exists: ${dest}`,
      EXIT_CODE.CONFLICT,
    );
  }
}
