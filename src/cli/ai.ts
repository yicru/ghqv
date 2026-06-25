import type { ProcessRunner } from '../application/ports';

export type AiTool = 'claude' | 'codex';

const TOOLS: readonly AiTool[] = ['claude', 'codex'];

/**
 * Detect available AI coding CLIs on PATH, in preference order (Claude Code
 * first because it is tuned for repository analysis).
 */
export async function detectAiTools(runner: ProcessRunner): Promise<AiTool[]> {
  const found: AiTool[] = [];
  for (const tool of TOOLS) {
    try {
      const r = await runner.run({ command: tool, args: ['--version'], output: 'capture' });
      if (r.exitCode === 0) found.push(tool);
    } catch {
      // tool not installed or not executable
    }
  }
  return found;
}

export interface AiSuggestion {
  role?: string;
  tech: string[];
}

/**
 * Ask an AI coding CLI to infer a repository role and tech tags from gathered
 * context. Returns empty values when the model output is not parseable.
 */
export async function suggestRoleTech(
  runner: ProcessRunner,
  tool: AiTool,
  repoContext: string,
): Promise<AiSuggestion> {
  const prompt = [
    'You are labeling a Git repository inside a virtual monorepo manifest.',
    'Based on the context below, produce:',
    '- "role": one concise sentence describing the repository purpose (<= 200 chars)',
    '- "tech": a short list of technology tags (e.g. TypeScript, React, Hono)',
    'Reply with ONLY a JSON object, no prose, in this exact shape:',
    '{"role":"...","tech":["..."]}',
    '',
    'Repository context:',
    repoContext,
  ].join('\n');

  const args =
    tool === 'claude'
      ? ['-p', prompt]
      : ['exec', '--skip-git-repo-check', '-s', 'read-only', '--color', 'never', prompt];

  const r = await runner.run({ command: tool, args, output: 'capture', stdin: 'ignore' });
  return parseSuggestion(r.stdout);
}

function parseSuggestion(raw: string): AiSuggestion {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { tech: [] };
  try {
    const obj = JSON.parse(m[0]) as { role?: unknown; tech?: unknown };
    const role = typeof obj.role === 'string' && obj.role.trim() ? obj.role.trim() : undefined;
    const tech = Array.isArray(obj.tech)
      ? obj.tech
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
      : [];
    return { role, tech };
  } catch {
    return { tech: [] };
  }
}
