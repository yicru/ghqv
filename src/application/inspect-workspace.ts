import { dirname, join, relative, resolve, sep } from 'node:path';
import type { CliContext } from '../cli/context';
import { resolveWorkspaceRoot } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { MANIFEST_FILENAME } from '../domain/manifest';
import {
  type NormalizedManifest,
  type NormalizedRepository,
  normalizeManifest,
} from '../domain/manifest';
import type { DesiredRepository } from '../domain/repository';
import { resolveWorkspaceArg, validateWorkspaceName } from '../domain/workspace';

function toDesired(r: NormalizedRepository): DesiredRepository {
  return {
    name: r.name,
    source: r.source,
    destinationRelativePath: r.path,
    mode: r.mode,
    role: r.role,
    tech: r.tech,
    dependsOn: r.dependsOn,
  };
}
import type { LocalState } from '../domain/local-state';
import type { DestinationKind, ObservedRepository, ResolvedRepository } from '../domain/repository';

export interface ResolvedWorkspace {
  path: string;
  manifest: NormalizedManifest;
  rawManifestContent: string;
}

export async function discoverWorkspaceFromCwd(
  ctx: CliContext,
  start: string,
): Promise<string | null> {
  let dir = resolve(start);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await ctx.fs.exists(join(dir, MANIFEST_FILENAME))) {
      return dir;
    }
    const parent = dir.split(sep).slice(0, -1).join(sep) || sep;
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function resolveWorkspace(
  ctx: CliContext,
  command: string,
): Promise<ResolvedWorkspace> {
  const wsRoot = await resolveWorkspaceRoot(ctx);
  let wsPath: string;
  if (ctx.options.workspace) {
    wsPath = resolveWorkspaceArg(ctx.options.workspace, wsRoot, ctx.cwd);
  } else {
    const found = await discoverWorkspaceFromCwd(ctx, ctx.cwd);
    if (!found) {
      throw new GhqvError(
        'GHQV_WORKSPACE_NOT_FOUND',
        'no workspace found from current directory',
        EXIT_CODE.NOT_FOUND,
        { hint: 'Run this command inside a workspace, or pass --workspace <name>.' },
      );
    }
    wsPath = found;
  }
  await validateWorkspaceDir(ctx, wsPath, command);
  const { content, manifest } = await ctx.manifest.read(wsPath);
  const normalized = normalizeManifest(manifest);
  return { path: wsPath, manifest: normalized, rawManifestContent: content };
}

export async function validateWorkspaceDir(
  ctx: CliContext,
  wsPath: string,
  _command: string,
): Promise<void> {
  const entry = await ctx.fs.lstat(wsPath);
  if (!entry || entry.kind !== 'directory') {
    throw new GhqvError(
      'GHQV_WORKSPACE_NOT_FOUND',
      `workspace not found: ${wsPath}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  if (!(await ctx.fs.exists(join(wsPath, MANIFEST_FILENAME)))) {
    throw new GhqvError(
      'GHQV_MANIFEST_NOT_FOUND',
      `manifest not found in ${wsPath}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  let toplevel: string;
  try {
    toplevel = await ctx.git.topLevel(wsPath);
  } catch {
    throw new GhqvError(
      'GHQV_WORKSPACE_INVALID',
      `workspace is not a git repository: ${wsPath}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  const realTop = await ctx.fs.realpath(toplevel);
  const realWs = await ctx.fs.realpath(wsPath);
  if (realTop !== realWs) {
    throw new GhqvError(
      'GHQV_WORKSPACE_INVALID',
      `workspace is not a git top-level: ${wsPath} (top-level ${realTop})`,
      EXIT_CODE.NOT_FOUND,
    );
  }
}

export interface SourceResolution {
  candidates: string[];
  resolved?: ResolvedRepository;
  status: 'missing' | 'ok' | 'ambiguous';
}

export async function resolveSource(
  ctx: CliContext,
  wsRealPath: string,
  desired: import('../domain/manifest').NormalizedRepository,
): Promise<SourceResolution> {
  const candidatesRaw = await ctx.ghq.resolveExact(desired.source);
  // realpath-dedupe
  const dedup = new Map<string, string>();
  for (const c of candidatesRaw) {
    try {
      const rp = await ctx.fs.realpath(c);
      dedup.set(rp, c);
    } catch {
      // skip invalid
    }
  }
  const candidates = [...dedup.values()];
  if (candidates.length === 0) return { candidates, status: 'missing' };
  if (candidates.length > 1) return { candidates, status: 'ambiguous' };
  const candidate = candidates[0] ?? '';
  // candidate validation
  let toplevel: string;
  try {
    toplevel = await ctx.git.topLevel(candidate);
  } catch {
    throw new GhqvError(
      'GHQV_UNSUPPORTED_VCS',
      `source is not a git repository: ${candidate}`,
      EXIT_CODE.EXTERNAL,
    );
  }
  const realTop = await ctx.fs.realpath(toplevel);
  const realCand = await ctx.fs.realpath(candidate);
  if (realTop !== realCand) {
    return { candidates, status: 'missing' };
  }
  const bare = await ctx.git.isBare(candidate);
  if (bare) {
    return { candidates, status: 'missing' };
  }
  // source != workspace relationships
  if (realCand === wsRealPath) {
    throw new GhqvError(
      'GHQV_SOURCE_INVALID',
      `source equals workspace: ${desired.source}`,
      EXIT_CODE.USAGE,
    );
  }
  if (realCand.startsWith(`${wsRealPath}${sep}`)) {
    throw new GhqvError(
      'GHQV_SOURCE_INVALID',
      `source is inside workspace: ${desired.source}`,
      EXIT_CODE.USAGE,
    );
  }
  if (wsRealPath.startsWith(`${realCand}${sep}`)) {
    throw new GhqvError(
      'GHQV_SOURCE_INVALID',
      `workspace is inside source: ${desired.source}`,
      EXIT_CODE.USAGE,
    );
  }
  const resolved: ResolvedRepository = {
    name: desired.name,
    source: desired.source,
    destinationRelativePath: desired.path,
    mode: desired.mode,
    role: desired.role,
    tech: desired.tech,
    dependsOn: desired.dependsOn,
    sourcePath: candidate,
    sourceRealPath: realCand,
  };
  return { candidates, resolved, status: 'ok' };
}

export interface ObservedBuild {
  observed: ObservedRepository[];
  state: LocalState | null;
}

export async function buildObserved(
  ctx: CliContext,
  ws: ResolvedWorkspace,
): Promise<ObservedBuild> {
  const wsReal = await ctx.fs.realpath(ws.path);
  const state = await ctx.state.read(ws.path);
  const stateMap = state?.repositories ?? {};
  const observed: ObservedRepository[] = [];
  for (const r of ws.manifest.repositories) {
    const dest = join(ws.path, r.path);
    const destEntry = await ctx.fs.lstat(dest);
    let kind: DestinationKind = 'missing';
    let rawLinkTarget: string | undefined;
    let resolvedLinkTarget: string | undefined;
    if (destEntry) {
      if (destEntry.kind === 'symlink') {
        kind = 'symlink';
        rawLinkTarget = destEntry.symlinkTarget;
        if (rawLinkTarget !== undefined) {
          try {
            const rp = await ctx.fs.realpath(dest);
            resolvedLinkTarget = rp;
          } catch {
            resolvedLinkTarget = undefined; // broken
          }
        }
      } else {
        kind = destEntry.kind;
      }
    }
    const resolution = await resolveSource(ctx, wsReal, r);
    let linkTarget: string | undefined;
    if (resolution.resolved) {
      try {
        const destDirReal = await ctx.fs.realpath(dirname(dest));
        linkTarget = relative(destDirReal, resolution.resolved.sourceRealPath);
      } catch {
        linkTarget = undefined;
      }
    }
    observed.push({
      desired: toDesired(r),
      resolvedSource: resolution.resolved,
      destinationPath: dest,
      destinationKind: kind,
      rawLinkTarget,
      resolvedLinkTarget,
      managedState: stateMap[r.name],
      linkTarget,
    });
  }
  return { observed, state };
}
