import { parseDocument } from 'yaml';
import type { CliContext } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import {
  type ManifestV1,
  normalizeManifest,
  normalizeSource,
  validateName,
} from '../domain/manifest';
import { stringifyManifest } from '../infrastructure/manifest/format';
import { regenerateManagedFiles } from './init-workspace';
import { resolveWorkspace } from './inspect-workspace';

export interface AddOptions {
  source: string;
  as?: string;
  path?: string;
  role?: string;
  tech?: string[];
  dependsOn?: string[];
}

export async function addRepository(ctx: CliContext, opts: AddOptions): Promise<void> {
  const ws = await resolveWorkspace(ctx, 'add');
  const { content, manifest } = await ctx.manifest.read(ws.path);
  const canonical = normalizeSource(opts.source);
  const name = opts.as ?? canonical.split('/').pop() ?? '';
  validateName(name, 'repository name');
  if (manifest.repositories[name]) {
    throw new GhqvError(
      'GHQV_MANIFEST_INVALID',
      `repository already exists: ${name}`,
      EXIT_CODE.USAGE,
    );
  }
  for (const r of Object.values(manifest.repositories)) {
    if (normalizeSource(r.source) === canonical) {
      throw new GhqvError(
        'GHQV_MANIFEST_INVALID',
        `source already registered: ${canonical}`,
        EXIT_CODE.USAGE,
      );
    }
  }

  const doc = parseDocument(content);
  const entry: Record<string, unknown> = { source: canonical };
  if (opts.path) entry.path = opts.path;
  if (opts.role) entry.role = opts.role;
  if (opts.tech?.length) entry.tech = opts.tech;
  if (opts.dependsOn?.length) entry.depends_on = opts.dependsOn;
  doc.setIn(['repositories', name], doc.createNode(entry));

  const newContent = stringifyManifest(doc);
  const newManifest = doc.toJSON() as ManifestV1;
  normalizeManifest(newManifest);
  await ctx.manifest.write(ws.path, newContent);
  await regenerateManagedFiles(ctx, ws.path, normalizeManifest(newManifest));
}

export async function removeRepository(
  ctx: CliContext,
  name: string,
  force: boolean,
): Promise<void> {
  const ws = await resolveWorkspace(ctx, 'remove');
  const { content, manifest } = await ctx.manifest.read(ws.path);
  if (!manifest.repositories[name]) {
    throw new GhqvError(
      'GHQV_WORKSPACE_NOT_FOUND',
      `repository not found: ${name}`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  const dependents: string[] = [];
  for (const [other, spec] of Object.entries(manifest.repositories)) {
    if (other === name) continue;
    if (spec.depends_on?.includes(name)) dependents.push(other);
  }
  if (dependents.length > 0 && !force) {
    throw new GhqvError(
      'GHQV_MANIFEST_INVALID',
      `repository ${name} is depended on by: ${dependents.join(', ')}`,
      EXIT_CODE.CONFLICT,
      { hint: 'Pass --force to remove it and clean up depends_on references.' },
    );
  }

  const doc = parseDocument(content);
  doc.deleteIn(['repositories', name]);
  if (force) {
    for (const dep of dependents) {
      const node = doc.getIn(['repositories', dep]);
      if (node && typeof node === 'object' && 'get' in (node as any)) {
        const arr = (node as any).get('depends_on');
        if (arr?.items) {
          const items = arr.items.filter((it: any) => it.value !== name);
          if (items.length === 0) {
            (node as any).delete('depends_on');
          } else {
            arr.items = items;
          }
        }
      }
    }
  }

  const newContent = stringifyManifest(doc);
  const newManifest = doc.toJSON() as ManifestV1;
  normalizeManifest(newManifest);
  await ctx.manifest.write(ws.path, newContent);
  await regenerateManagedFiles(ctx, ws.path, normalizeManifest(newManifest));
  if (dependents.length > 0) {
    ctx.stderr(`warning: removed depends_on references from: ${dependents.join(', ')}`);
  }
}
