import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Document } from 'yaml';
import type { CliContext } from '../cli/context';
import { resolveWorkspaceRoot } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import {
  MANIFEST_FILENAME,
  type ManifestV1,
  type NormalizedManifest,
  emptyManifest,
  normalizeManifest,
} from '../domain/manifest';
import { validateWorkspaceName } from '../domain/workspace';
import { stringifyManifest } from '../infrastructure/manifest/format';
import { renderAgents } from '../rendering/agents';
import { renderClaude } from '../rendering/claude';
import { renderGitignore } from '../rendering/gitignore';
import { GITIGNORE_MARKERS, MD_MARKERS } from '../rendering/managed-block';

const ARCH_README = `# Architecture

Place architecture documents and cross-repository decisions in this directory.

Suggested documents:

- \`system-overview.md\`
- \`api-contracts.md\`
- \`deployment.md\`
- \`adr/\`
`;

export async function initWorkspace(
  ctx: CliContext,
  arg: string,
  description?: string,
): Promise<string> {
  let wsPath: string;
  let name: string;
  if (arg === '.') {
    wsPath = resolve(ctx.cwd);
    name = wsPath.split('/').pop() ?? 'workspace';
  } else {
    validateWorkspaceName(arg);
    name = arg;
    const wsRoot = await resolveWorkspaceRoot(ctx);
    wsPath = resolve(wsRoot, name);
  }

  const existing = await ctx.fs.lstat(wsPath);
  if (existing) {
    if (existing.kind !== 'directory') {
      throw new GhqvError(
        'GHQV_USAGE_ERROR',
        `destination is not a directory: ${wsPath}`,
        EXIT_CODE.USAGE,
      );
    }
    if (await ctx.fs.exists(join(wsPath, MANIFEST_FILENAME))) {
      throw new GhqvError(
        'GHQV_WORKSPACE_INVALID',
        `workspace already initialized: ${wsPath}`,
        EXIT_CODE.CONFLICT,
        { hint: 'Use a different name, or run `ghqv add` inside the existing workspace.' },
      );
    }
  } else {
    await mkdir(wsPath, { recursive: true });
  }

  let isGit = false;
  try {
    const toplevel = await ctx.git.topLevel(wsPath);
    const realTop = await ctx.fs.realpath(toplevel);
    const realWs = await ctx.fs.realpath(wsPath);
    if (realTop === realWs) isGit = true;
  } catch {
    isGit = false;
  }
  if (!isGit) {
    await ctx.git.init(wsPath);
  }

  const manifest: ManifestV1 = emptyManifest(name);
  if (description) manifest.workspace.description = description;
  const content = stringifyManifest(new Document(manifest));
  await ctx.manifest.write(wsPath, content);

  await regenerateManagedFiles(ctx, wsPath, normalizeManifest(manifest));

  const archPath = join(wsPath, 'architecture', 'README.md');
  if (!(await ctx.fs.exists(archPath))) {
    await ctx.fs.mkdirAll(join(wsPath, 'architecture'));
    await ctx.fs.writeTextAtomic(archPath, ARCH_README, 0o644);
  }

  return wsPath;
}

export function validateManagedMarkers(
  content: string,
  markers: { begin: string; end: string },
  file: string,
): void {
  const begin = content.indexOf(markers.begin);
  const end = content.indexOf(markers.end);
  if (begin !== -1 || end !== -1) {
    if (begin === -1 || end === -1 || begin > end) {
      throw new GhqvError(
        'GHQV_MANAGED_BLOCK_INVALID',
        `managed markers are malformed in ${file}`,
        EXIT_CODE.CONFLICT,
        { hint: 'Fix the markers manually or remove the file before re-running.' },
      );
    }
  }
}

export async function regenerateManagedFiles(
  ctx: CliContext,
  wsPath: string,
  manifest: NormalizedManifest,
): Promise<{ agentsChanged: boolean; gitignoreChanged: boolean; claudeChanged: boolean }> {
  const gitignorePath = join(wsPath, '.gitignore');
  const agentsPath = join(wsPath, 'AGENTS.md');
  const claudePath = join(wsPath, 'CLAUDE.md');
  const giExisting = (await ctx.fs.exists(gitignorePath))
    ? await ctx.fs.readText(gitignorePath)
    : null;
  const agentsExisting = (await ctx.fs.exists(agentsPath))
    ? await ctx.fs.readText(agentsPath)
    : null;
  const claudeExisting = (await ctx.fs.exists(claudePath))
    ? await ctx.fs.readText(claudePath)
    : null;

  if (giExisting) validateManagedMarkers(giExisting, GITIGNORE_MARKERS, gitignorePath);
  if (agentsExisting) validateManagedMarkers(agentsExisting, MD_MARKERS, agentsPath);

  const gi = renderGitignore(manifest, giExisting);
  const ag = renderAgents(manifest, agentsExisting);
  const cl = renderClaude(claudeExisting);
  if (gi.changed) await ctx.fs.writeTextAtomic(gitignorePath, gi.content, 0o644);
  if (ag.changed) await ctx.fs.writeTextAtomic(agentsPath, ag.content, 0o644);
  if (cl.changed) await ctx.fs.writeTextAtomic(claudePath, cl.content, 0o644);
  return { agentsChanged: ag.changed, gitignoreChanged: gi.changed, claudeChanged: cl.changed };
}
