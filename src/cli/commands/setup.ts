import { checkbox, confirm, input, search } from '@inquirer/prompts';
import type { Command } from 'commander';
import { addRepository } from '../../application/edit-manifest';
import { initWorkspace } from '../../application/init-workspace';
import { syncWorkspace } from '../../application/sync-workspace';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { validateName } from '../../domain/manifest';
import { isValidWorkspaceName } from '../../domain/workspace';
import { renderSyncPlan } from '../../presentation/console-reporter';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import type { CliContext } from '../context';

interface RepoDraft {
  source: string;
  as: string;
  role?: string;
  tech: string[];
  dependsOn: string[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function basename(source: string): string {
  return source.split('/').pop() ?? source;
}

function fuzzyMatch(term: string | undefined, target: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  const g = target.toLowerCase();
  let i = 0;
  for (const ch of g) {
    if (ch === t[i]) i++;
    if (i >= t.length) return true;
  }
  return false;
}

function requireTty(ctx: CliContext): void {
  if (ctx.options.json) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      '`ghqv setup` is interactive and cannot be combined with --json',
      EXIT_CODE.USAGE,
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      '`ghqv setup` requires an interactive TTY',
      EXIT_CODE.USAGE,
    );
  }
}

async function promptWorkspaceName(): Promise<string> {
  return input({
    message: 'Workspace name:',
    validate: (v) => {
      if (!v) return 'name is required';
      if (!isValidWorkspaceName(v)) {
        return `must match ${NAME_RE.source}`;
      }
      return true;
    },
  });
}

async function promptDescription(): Promise<string | undefined> {
  const desc = await input({
    message: 'Description (optional):',
    required: false,
  });
  return desc.trim() || undefined;
}

async function promptRepository(all: string[], chosen: Set<string>): Promise<string | null> {
  const available = all.filter((s) => !chosen.has(s));
  if (available.length === 0) return null;
  const selection = await search<string>({
    message: 'Pick a repository (type to fuzzy find):',
    source: (term) => {
      const filtered = available
        .filter((s) => fuzzyMatch(term, s))
        .sort((a, b) => a.localeCompare(b));
      if (filtered.length === 0) {
        return [{ name: 'no matches', value: '', disabled: true }];
      }
      return filtered.map((s) => ({ name: s, value: s }));
    },
  });
  if (!selection) return null;
  return selection;
}

async function promptRepoDetails(source: string, existingNames: string[]): Promise<RepoDraft> {
  const defaultName = basename(source);
  const as = await input({
    message: `Logical name for ${source}:`,
    default: defaultName,
    validate: (v) => {
      if (!v) return 'name is required';
      try {
        validateName(v, 'repository name');
      } catch (e) {
        return (e as Error).message;
      }
      if (existingNames.includes(v)) return `${v} is already used in this workspace`;
      return true;
    },
  });

  // role / tech / depends_on are all optional. Default to skipping so the
  // common path is "pick a repo, confirm the name, move on".
  const wantDetails = await confirm({
    message: 'Configure role / tech / depends_on for this repository?',
    default: false,
  });
  if (!wantDetails) {
    return { source, as, role: undefined, tech: [], dependsOn: [] };
  }

  const role = await input({
    message: 'Role (optional):',
    required: false,
  });

  const techRaw = await input({
    message: 'Tech tags, space-separated (optional):',
    required: false,
  });
  const tech = techRaw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let dependsOn: string[] = [];
  if (existingNames.length > 0) {
    const deps = await checkbox({
      message: 'Depends on (optional):',
      choices: existingNames.map((n) => ({ name: n, value: n })),
    });
    dependsOn = deps;
  }

  return {
    source,
    as,
    role: role.trim() || undefined,
    tech,
    dependsOn,
  };
}

export async function runSetup(ctx: CliContext): Promise<void> {
  requireTty(ctx);

  ctx.stderr(`${ctx.colors.bold('ghqv setup')} — interactive workspace builder\n`);

  const all = await ctx.ghq.list();
  if (all.length === 0) {
    throw new GhqvError(
      'GHQV_SOURCE_NOT_FOUND',
      'no repositories found under `ghq list`',
      EXIT_CODE.NOT_FOUND,
      { hint: 'Run `ghq get <url>` first to clone repositories.' },
    );
  }

  const name = await promptWorkspaceName();
  const description = await promptDescription();

  const drafts: RepoDraft[] = [];
  const chosenSources = new Set<string>();
  const usedNames: string[] = [];

  ctx.stderr(`\nFound ${all.length} ghq-managed repository(ies). Select the ones to include.\n`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const picked = await promptRepository(all, chosenSources);
    if (!picked) break; // user cancelled the search prompt
    chosenSources.add(picked);
    const draft = await promptRepoDetails(picked, usedNames);
    drafts.push(draft);
    usedNames.push(draft.as);
    ctx.stderr(ctx.colors.green(`✓ added ${draft.as} (${draft.source})\n`));
    const more = await confirm({
      message: 'Add another repository?',
      default: drafts.length < 3,
    });
    if (!more) break;
  }

  if (drafts.length === 0) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      'no repositories selected; aborting setup',
      EXIT_CODE.USAGE,
    );
  }

  // Summary
  ctx.stderr('\n');
  ctx.stderr(ctx.colors.bold(`Workspace: ${name}`));
  if (description) ctx.stderr(ctx.colors.dim(`  ${description}`));
  for (const d of drafts) {
    const depStr = d.dependsOn.length ? ` -> ${d.dependsOn.join(', ')}` : '';
    ctx.stderr(`  ${d.as}  ${ctx.colors.dim(d.source)}${ctx.colors.dim(depStr)}`);
  }
  ctx.stderr('\n');

  const proceed = await confirm({
    message: 'Create workspace and sync now?',
    default: true,
  });
  if (!proceed) {
    ctx.stderr('aborted');
    return;
  }

  // Execute: init + add(×n) + sync
  const wsPath = await initWorkspace(ctx, name, description);
  ctx.stderr(ctx.colors.green(`✓ initialized ${wsPath}`));

  // Subsequent commands need to resolve this workspace. Set the global
  // workspace option so add/sync target the freshly created workspace.
  ctx.options.workspace = name;

  for (const d of drafts) {
    await addRepository(ctx, {
      source: d.source,
      as: d.as,
      role: d.role,
      tech: d.tech,
      dependsOn: d.dependsOn,
    });
    ctx.stderr(ctx.colors.green(`✓ registered ${d.as}`));
  }

  const outcome = await syncWorkspace(ctx, {
    dryRun: false,
    offline: false,
    noGet: false,
    prune: false,
    repair: false,
  });
  ctx.stdout(renderSyncPlan(outcome.plan.actions, ctx.colors));

  if (ctx.options.json) {
    emitJson(okEnvelope('setup', { path: wsPath, repositories: drafts.map((d) => d.as) }));
  } else {
    ctx.stdout(wsPath);
  }
}

export function registerSetup(program: Command, mkCtx: () => Promise<CliContext>): void {
  program
    .command('setup')
    .description('Interactively create a workspace and register repositories')
    .action(async () => {
      const ctx = await mkCtx();
      await runSetup(ctx);
    });
}
