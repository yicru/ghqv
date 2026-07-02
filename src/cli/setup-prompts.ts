import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkbox, confirm, input } from '@inquirer/prompts';
import { EXIT_CODE, GhqvError } from '../domain/errors';
import { validateName } from '../domain/manifest';
import { isValidWorkspaceName } from '../domain/workspace';
import type { AiSuggestion } from './ai';
import type { CliContext } from './context';
import { type RepoMetadataDraft, dependencyCandidateNames } from './setup-drafts';
import { formatTechTagsInput, parseTechTagsInput } from './tech-tags';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const README_FILENAMES = ['README.md', 'README.MD', 'readme.md', 'README'] as const;

function basename(source: string): string {
  return source.split('/').pop() ?? source;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function ignoreOptionalContextRead(error: unknown): void {
  if (error instanceof Error) return;
  throw error;
}

export function requireInteractive(ctx: CliContext): void {
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

export async function requireFzf(ctx: CliContext): Promise<void> {
  try {
    await ctx.process.run({ command: 'fzf', args: ['--version'], output: 'capture' });
  } catch (error) {
    throw new GhqvError(
      'GHQV_EXTERNAL_COMMAND_FAILED',
      '`fzf` is required for repository selection',
      EXIT_CODE.EXTERNAL,
      {
        hint: 'Install fzf: `brew install fzf` (macOS) or see https://github.com/junegunn/fzf',
        cause: error,
      },
    );
  }
}

function fzfMulti(items: string[], prompt: string, header: string): string[] | null {
  if (items.length === 0) return [];
  const inputText = `${items.join('\n')}\n`;
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
    { input: inputText, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  if (result.status !== 0) return null;
  const out = (result.stdout?.toString('utf8') ?? '').trim();
  if (out.length === 0) return [];
  return out.split('\n');
}

export async function promptWorkspaceName(): Promise<string> {
  return input({
    message: 'Workspace name:',
    validate: (value) => {
      if (!value) return 'name is required';
      if (!isValidWorkspaceName(value)) {
        return `must match ${NAME_RE.source}`;
      }
      return true;
    },
  });
}

export async function promptDescription(): Promise<string | undefined> {
  const desc = await input({
    message: 'Description (optional):',
    required: false,
  });
  return desc.trim() || undefined;
}

export async function promptRepositories(all: string[], already: Set<string>): Promise<string[]> {
  const available = all.filter((source) => !already.has(source)).sort((a, b) => a.localeCompare(b));
  if (available.length === 0) return [];
  const header = `${available.length} repository(ies) | TAB select | CTRL-A all | CTRL-D none | ENTER confirm`;
  const picked = fzfMulti(available, 'Repositories> ', header);
  return picked ?? [];
}

export async function buildRepoContext(ctx: CliContext, source: string): Promise<string> {
  const paths = await ctx.ghq.resolveExact(source);
  let out = `source: ${source}`;
  if (paths.length === 0) return out;
  const path = paths[0] ?? '';
  out += `\npath: ${path}`;
  for (const fileName of README_FILENAMES) {
    try {
      const text = await ctx.fs.readText(join(path, fileName));
      out += `\n--- ${fileName} (excerpt) ---\n${text.slice(0, 3000)}`;
      break;
    } catch (error) {
      ignoreOptionalContextRead(error);
    }
  }
  try {
    const pkg = await ctx.fs.readText(join(path, 'package.json'));
    out += `\n--- package.json (excerpt) ---\n${pkg.slice(0, 1500)}`;
  } catch (error) {
    ignoreOptionalContextRead(error);
  }
  try {
    const entries = await ctx.fs.readdir(path);
    out += `\n--- top-level entries ---\n${entries.slice(0, 40).join(', ')}`;
  } catch (error) {
    ignoreOptionalContextRead(error);
  }
  return out;
}

export async function promptRepoMetadata(
  source: string,
  existingNames: string[],
  suggestion?: AiSuggestion,
): Promise<RepoMetadataDraft> {
  const defaultName = basename(source);
  const as = await input({
    message: `Logical name for ${source}:`,
    default: defaultName,
    validate: (value) => {
      if (!value) return 'name is required';
      try {
        validateName(value, 'repository name');
      } catch (error) {
        return errorMessage(error);
      }
      if (existingNames.includes(value)) return `${value} is already used in this workspace`;
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
    const wantDetails = await confirm({
      message: 'Configure role / tech for this repository?',
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

  return { source, as, role, tech };
}

export async function promptRepoDependencies(
  repoName: string,
  allNames: readonly string[],
): Promise<string[]> {
  const candidates = dependencyCandidateNames(repoName, allNames);
  if (candidates.length === 0) return [];
  return checkbox({
    message: `Depends on for ${repoName} (optional):`,
    choices: candidates.map((name) => ({ name, value: name })),
  });
}
