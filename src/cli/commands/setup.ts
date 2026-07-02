import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkbox, confirm, input } from '@inquirer/prompts';
import type { Command } from 'commander';
import { addRepository } from '../../application/edit-manifest';
import { initWorkspace } from '../../application/init-workspace';
import { syncWorkspace } from '../../application/sync-workspace';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { validateName } from '../../domain/manifest';
import { isValidWorkspaceName } from '../../domain/workspace';
import { renderSyncPlan } from '../../presentation/console-reporter';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import { type AiSuggestion, type AiTool, detectAiTools, suggestRoleTech } from '../ai';
import type { CliContext } from '../context';
import { formatTechTagsInput, parseTechTagsInput } from '../tech-tags';

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

function requireInteractive(ctx: CliContext): void {
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

async function requireFzf(ctx: CliContext): Promise<void> {
  try {
    await ctx.process.run({ command: 'fzf', args: ['--version'], output: 'capture' });
  } catch (e) {
    throw new GhqvError(
      'GHQV_EXTERNAL_COMMAND_FAILED',
      '`fzf` is required for repository selection',
      EXIT_CODE.EXTERNAL,
      {
        hint: 'Install fzf: `brew install fzf` (macOS) or see https://github.com/junegunn/fzf',
        cause: e,
      },
    );
  }
}

/**
 * Run `fzf` in multi-select mode, feeding `items` on stdin and returning the
 * selected entries. fzf renders its UI on /dev/tty, so stdin/stdout can be
 * piped while the picker still runs interactively. Returns null when the user
 * cancels (Esc / Ctrl-C / Ctrl-G).
 */
function fzfMulti(items: string[], prompt: string, header: string): string[] | null {
  if (items.length === 0) return [];
  const input = `${items.join('\n')}\n`;
  const result = spawnSync(
    'fzf',
    [
      '--multi',
      `--prompt=${prompt}`,
      `--header=${header}`,
      '--height=40%',
      '--reverse',
      '--border',
      '--no-info',
      '--bind=ctrl-a:select-all,ctrl-d:deselect-all',
    ],
    { input, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  if (result.status !== 0) return null; // user cancelled (Esc/Ctrl-C) or no selection
  const out = (result.stdout?.toString('utf8') ?? '').trim();
  if (out.length === 0) return [];
  return out.split('\n');
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

async function promptRepositories(all: string[], already: Set<string>): Promise<string[]> {
  const available = all.filter((s) => !already.has(s)).sort((a, b) => a.localeCompare(b));
  if (available.length === 0) return [];
  const header = `${available.length} repository(ies) | TAB select | CTRL-A all | CTRL-D none | ENTER confirm`;
  const picked = fzfMulti(available, 'Repositories> ', header);
  return picked ?? [];
}

/** Gather a compact textual snapshot of a repository for the AI to reason over. */
async function buildRepoContext(ctx: CliContext, source: string): Promise<string> {
  const paths = await ctx.ghq.resolveExact(source);
  let out = `source: ${source}`;
  if (paths.length === 0) return out;
  const path = paths[0] ?? '';
  out += `\npath: ${path}`;
  for (const f of ['README.md', 'README.MD', 'readme.md', 'README']) {
    try {
      const t = await ctx.fs.readText(join(path, f));
      out += `\n--- ${f} (excerpt) ---\n${t.slice(0, 3000)}`;
      break;
    } catch {
      // file absent
    }
  }
  try {
    const pkg = await ctx.fs.readText(join(path, 'package.json'));
    out += `\n--- package.json (excerpt) ---\n${pkg.slice(0, 1500)}`;
  } catch {
    // not a node project
  }
  try {
    const entries = await ctx.fs.readdir(path);
    out += `\n--- top-level entries ---\n${entries.slice(0, 40).join(', ')}`;
  } catch {
    // unreadable
  }
  return out;
}

async function promptRepoDetails(
  source: string,
  existingNames: string[],
  suggestion?: AiSuggestion,
): Promise<RepoDraft> {
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

  let role: string | undefined;
  let tech: string[] = [];

  const aiPrefilled = !!(suggestion && (suggestion.role || suggestion.tech.length > 0));
  if (aiPrefilled) {
    const roleInput = await input({
      message: 'Role (AI suggestion, edit if needed):',
      default: suggestion?.role ?? '',
      required: false,
    });
    role = roleInput.trim() || undefined;
    const techInput = await input({
      message: 'Tech tags (AI suggestion, edit if needed):',
      default: formatTechTagsInput(suggestion?.tech ?? []),
      required: false,
    });
    tech = parseTechTagsInput(techInput);
  } else {
    // role / tech / depends_on are all optional. Default to skipping so the
    // common path is "pick a repo, confirm the name, move on".
    const wantDetails = await confirm({
      message: 'Configure role / tech / depends_on for this repository?',
      default: false,
    });
    if (wantDetails) {
      const roleInput = await input({ message: 'Role (optional):', required: false });
      role = roleInput.trim() || undefined;
      const techInput = await input({
        message: 'Tech tags, comma-separated (optional):',
        required: false,
      });
      tech = parseTechTagsInput(techInput);
    }
  }

  let dependsOn: string[] = [];
  if (existingNames.length > 0) {
    const deps = await checkbox({
      message: 'Depends on (optional):',
      choices: existingNames.map((n) => ({ name: n, value: n })),
    });
    dependsOn = deps;
  }

  return { source, as, role, tech, dependsOn };
}

export async function runSetup(ctx: CliContext): Promise<void> {
  requireInteractive(ctx);
  await requireFzf(ctx);

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

  // Detect AI coding CLIs (Claude Code and/or Codex) for optional role/tech
  // inference. Failure to detect is non-fatal: the user just fills metadata
  // manually (or skips it).
  const aiTools = await detectAiTools(ctx.process);
  let useAi = false;
  if (aiTools.length > 0) {
    useAi = await confirm({
      message: `Use ${aiTools.join(' or ')} to infer role and tech tags for each repository?`,
      default: true,
    });
  }

  const name = await promptWorkspaceName();
  const description = await promptDescription();

  const drafts: RepoDraft[] = [];
  const chosenSources = new Set<string>();
  const usedNames: string[] = [];

  ctx.stderr(`\nFound ${all.length} ghq-managed repository(ies). Select the ones to include.\n`);

  // Batch-select multiple repositories with fzf (Tab to toggle, Enter to
  // confirm). After each batch the user can optionally pick more from the
  // remaining list.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const picked = await promptRepositories(all, chosenSources);
    if (picked.length === 0) break;
    for (const source of picked) {
      chosenSources.add(source);
      let suggestion: AiSuggestion | undefined;
      if (useAi && aiTools.length > 0) {
        ctx.stderr(ctx.colors.dim(`→ inferring role/tech for ${source} ...`));
        const repoCtx = await buildRepoContext(ctx, source);
        for (const tool of aiTools) {
          try {
            suggestion = await suggestRoleTech(ctx.process, tool, repoCtx);
            break;
          } catch (e) {
            // fall back to the next available AI CLI
            ctx.stderr(ctx.colors.dim(`  ${tool} failed: ${(e as Error).message}`));
          }
        }
      }
      const draft = await promptRepoDetails(source, usedNames, suggestion);
      drafts.push(draft);
      usedNames.push(draft.as);
      ctx.stderr(ctx.colors.green(`✓ added ${draft.as} (${draft.source})\n`));
    }
    if (chosenSources.size >= all.length) break;
    const more = await confirm({
      message: 'Add more repositories from the remaining list?',
      default: false,
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

  // Create the initial commit so the workspace ships as a clean starting
  // point (manifest + generated files; symlinked sources are gitignored).
  try {
    await ctx.git.addAll(wsPath);
    await ctx.git.commit(wsPath, `Initial ghqv workspace: ${name}`);
    ctx.stderr(ctx.colors.green('✓ initial commit created'));
  } catch (e) {
    ctx.stderr(
      ctx.colors.yellow(`warning: could not create initial commit: ${(e as Error).message}`),
    );
  }

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
