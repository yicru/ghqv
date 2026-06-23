import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runGhqv(
  env: Record<string, string>,
  args: string[],
  cwd?: string,
): Promise<RunResult> {
  const repoRoot = join(import.meta.dir, '..', '..');
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', join(repoRoot, 'src', 'index.ts'), ...args], {
      env,
      cwd: cwd ?? env.GHQV_WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}
