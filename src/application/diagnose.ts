import { join } from 'node:path';
import type { CliContext } from '../cli/context';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { classifyObserved } from '../domain/plan';
import { agentsLineCount } from '../rendering/agents';
import { GITIGNORE_MARKERS, MD_MARKERS, extractManagedBlock } from '../rendering/managed-block';
import { buildObserved, resolveWorkspace } from './inspect-workspace';

export interface DoctorFinding {
  level: 'error' | 'warning' | 'ok';
  message: string;
  hint?: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  fixable: boolean;
}

export async function diagnose(ctx: CliContext, fix: boolean): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];

  // global checks
  try {
    await ctx.process.run({ command: 'git', args: ['--version'], output: 'capture' });
    findings.push({ level: 'ok', message: 'git is available' });
  } catch {
    findings.push({ level: 'error', message: 'git is not available on PATH' });
  }
  try {
    await ctx.process.run({ command: 'ghq', args: ['--version'], output: 'capture' });
    findings.push({ level: 'ok', message: 'ghq is available' });
  } catch {
    findings.push({ level: 'error', message: 'ghq is not available on PATH' });
  }

  let ws: {
    path: string;
    manifest: import('../domain/manifest').NormalizedManifest;
    rawManifestContent: string;
  };
  try {
    ws = await resolveWorkspace(ctx, 'doctor');
  } catch (e) {
    if (e instanceof GhqvError) {
      findings.push({ level: 'error', message: e.message, hint: e.hint });
      return { findings, fixable: false };
    }
    throw e;
  }

  const lockInfo = await ctx.lock.current(ws.path);
  if (lockInfo) {
    findings.push({
      level: 'warning',
      message: `lock present (pid ${lockInfo.pid})`,
      hint: 'Run `ghqv doctor --fix` if stale.',
    });
  }

  const build = await buildObserved(ctx, ws);
  for (const o of build.observed) {
    const st = classifyObserved(o);
    if (st !== 'ready' && st !== 'adoptable') {
      findings.push({ level: 'warning', message: `repository ${o.desired.name}: ${st}` });
    }
  }

  // dependency cycle
  const cycle = detectCycle(ws.manifest);
  if (cycle) {
    findings.push({
      level: 'warning',
      message: `dependency cycle detected: ${cycle.join(' -> ')}`,
    });
  }

  // managed markers
  await checkMarkers(ctx, ws.path, '.gitignore', GITIGNORE_MARKERS, findings);
  await checkMarkers(ctx, ws.path, 'AGENTS.md', MD_MARKERS, findings);
  await checkMarkers(ctx, ws.path, 'CLAUDE.md', MD_MARKERS, findings);

  // agents size
  if (agentsLineCount(ws.manifest) > 200) {
    findings.push({ level: 'warning', message: 'AGENTS.md managed block exceeds 200 lines' });
  }

  if (fix) {
    // create state dir, regenerate managed blocks (if markers valid), remove stale lock, create arch readme
    if (lockInfo) {
      const removed = await ctx.lock.removeStale(ws.path);
      if (removed) findings.push({ level: 'ok', message: 'removed stale lock' });
    }
    const archPath = join(ws.path, 'architecture', 'README.md');
    if (!(await ctx.fs.exists(archPath))) {
      await ctx.fs.mkdirAll(join(ws.path, 'architecture'));
      await ctx.fs.writeTextAtomic(archPath, '# Architecture\n', 0o644);
      findings.push({ level: 'ok', message: 'created architecture/README.md' });
    }
  }

  return { findings, fixable: findings.some((f) => f.level === 'warning') };
}

async function checkMarkers(
  ctx: CliContext,
  wsPath: string,
  file: string,
  markers: { begin: string; end: string },
  findings: DoctorFinding[],
): Promise<void> {
  const p = join(wsPath, file);
  if (!(await ctx.fs.exists(p))) {
    findings.push({ level: 'warning', message: `missing managed file: ${file}` });
    return;
  }
  const content = await ctx.fs.readText(p);
  const block = extractManagedBlock(content, markers);
  if (block === null) {
    findings.push({ level: 'warning', message: `missing managed block in ${file}` });
    return;
  }
  const begin = content.indexOf(markers.begin);
  const end = content.indexOf(markers.end);
  if (begin === -1 || end === -1 || begin > end) {
    findings.push({
      level: 'error',
      message: `malformed managed markers in ${file}`,
      hint: 'Cannot be auto-fixed.',
    });
  }
}

function detectCycle(manifest: import('../domain/manifest').NormalizedManifest): string[] | null {
  const graph = new Map<string, string[]>();
  for (const r of manifest.repositories) graph.set(r.name, r.dependsOn);
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  function dfs(node: string): string[] | null {
    if (stack.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const dep of graph.get(node) ?? []) {
      const c = dfs(dep);
      if (c) return c;
    }
    stack.delete(node);
    path.pop();
    return null;
  }
  for (const n of graph.keys()) {
    const c = dfs(n);
    if (c) return c;
  }
  return null;
}

void EXIT_CODE;
