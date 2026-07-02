import { confirm } from '@inquirer/prompts';
import type { Command } from 'commander';
import { addRepository } from '../../application/edit-manifest';
import { initWorkspace } from '../../application/init-workspace';
import { syncWorkspace } from '../../application/sync-workspace';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { renderSyncPlan } from '../../presentation/console-reporter';
import { emitJson, okEnvelope } from '../../presentation/json-reporter';
import { type AiSuggestion, detectAiTools, suggestRoleTech } from '../ai';
import type { CliContext } from '../context';
import {
  type RepoDraft,
  type RepoMetadataDraft,
  orderDraftsForRegistration,
} from '../setup-drafts';
import {
  buildRepoContext,
  errorMessage,
  promptDescription,
  promptRepoDependencies,
  promptRepoMetadata,
  promptRepositories,
  promptWorkspaceName,
  requireFzf,
  requireInteractive,
} from '../setup-prompts';

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

  const selectedSources: string[] = [];
  const chosenSources = new Set<string>();

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
      selectedSources.push(source);
    }
    if (chosenSources.size >= all.length) break;
    const more = await confirm({
      message: 'Add more repositories from the remaining list?',
      default: false,
    });
    if (!more) break;
  }

  if (selectedSources.length === 0) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      'no repositories selected; aborting setup',
      EXIT_CODE.USAGE,
    );
  }

  const metadataDrafts: RepoMetadataDraft[] = [];
  const usedNames: string[] = [];
  for (const source of selectedSources) {
    let suggestion: AiSuggestion | undefined;
    if (useAi && aiTools.length > 0) {
      ctx.stderr(ctx.colors.dim(`→ inferring role/tech for ${source} ...`));
      const repoCtx = await buildRepoContext(ctx, source);
      for (const tool of aiTools) {
        try {
          suggestion = await suggestRoleTech(ctx.process, tool, repoCtx);
          break;
        } catch (error) {
          // fall back to the next available AI CLI
          ctx.stderr(ctx.colors.dim(`  ${tool} failed: ${errorMessage(error)}`));
        }
      }
    }
    const draft = await promptRepoMetadata(source, usedNames, suggestion);
    metadataDrafts.push(draft);
    usedNames.push(draft.as);
  }

  const allNames = metadataDrafts.map((draft) => draft.as);
  const drafts: RepoDraft[] = [];
  for (const draft of metadataDrafts) {
    const dependsOn = await promptRepoDependencies(draft.as, allNames);
    drafts.push({ ...draft, dependsOn });
    ctx.stderr(ctx.colors.green(`✓ added ${draft.as} (${draft.source})\n`));
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

  for (const d of orderDraftsForRegistration(drafts)) {
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
  } catch (error) {
    ctx.stderr(
      ctx.colors.yellow(`warning: could not create initial commit: ${errorMessage(error)}`),
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
