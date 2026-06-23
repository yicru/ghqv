import type { ProcessRequest, ProcessResult, ProcessRunner } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;

function redact(arg: string): string {
  // redact userinfo and query in URL-like args
  try {
    const u = new URL(arg);
    if (u.username || u.password || u.search) {
      u.username = '';
      u.password = '';
      u.search = '';
      return u.toString();
    }
  } catch {
    // not a URL
  }
  return arg;
}

export function redactArgs(args: string[]): string[] {
  return args.map(redact);
}

export function shellDisplay(command: string, args: string[]): string {
  return [command, ...redactArgs(args)].map((a) => quote(a)).join(' ');
}

function quote(a: string): string {
  if (/^[\w@:/._~+=,%;-]+$/.test(a)) return a;
  return `'${a.replace(/'/g, "'\\''")}'`;
}

export class BunProcessRunner implements ProcessRunner {
  async run(request: ProcessRequest): Promise<ProcessResult> {
    const max = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const proc = Bun.spawn({
      cmd: [request.command, ...request.args],
      cwd: request.cwd,
      env: request.env ?? process.env,
      stdin: request.stdin ?? 'ignore',
      stdout: request.output === 'inherit' ? 'inherit' : 'pipe',
      stderr: request.output === 'inherit' ? 'inherit' : 'pipe',
      signal: request.signal,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    if (request.output !== 'inherit') {
      const [outReader, errReader] = [proc.stdout, proc.stderr] as const;
      const out = outReader ? Bun.readableStreamToText(outReader) : Promise.resolve('');
      const err = errReader ? Bun.readableStreamToText(errReader) : Promise.resolve('');
      [stdout, stderr] = await Promise.all([out, err]);
      if (stdout.length > max || stderr.length > max) {
        timedOut = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }

    const exit = await proc.exited;
    const exitCode = exit === null ? null : exit;
    const signal: NodeJS.Signals | null = null;

    if (timedOut || (exitCode !== null && exitCode !== 0)) {
      throw new GhqvError(
        'GHQV_EXTERNAL_COMMAND_FAILED',
        `external command failed: ${shellDisplay(request.command, request.args)}`,
        EXIT_CODE.EXTERNAL,
        {
          details: {
            cwd: request.cwd,
            exitCode,
            signal,
            stderr: stderr.slice(-64 * 1024),
          },
        },
      );
    }

    return { exitCode, signal, stdout, stderr, timedOut };
  }
}
