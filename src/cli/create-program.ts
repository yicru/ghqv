import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Command, CommanderError, type OptionValues } from 'commander';
import { BUILD_DATE, COMMIT, VERSION } from '../build-info';
import { EXIT_CODE, GhqvError, internalError } from '../domain/errors';
import { GitConfigStore } from '../infrastructure/config/git-config-store';
import { FileLockManager } from '../infrastructure/filesystem/lock';
import { NodeFileSystem } from '../infrastructure/filesystem/node-filesystem';
import { GhqProcessClient } from '../infrastructure/ghq/ghq-client';
import { GitProcessClient } from '../infrastructure/git/git-client';
import { YamlManifestStore } from '../infrastructure/manifest/yaml-manifest-store';
import { BunProcessRunner } from '../infrastructure/process/bun-process-runner';
import { JsonStateStore } from '../infrastructure/state/json-state-store';
import { type ColorMode, createColors } from '../presentation/colors';
import { emitJson, errorEnvelope } from '../presentation/json-reporter';
import { registerAdd } from './commands/add';
import { registerClone } from './commands/clone';
import { registerConfig } from './commands/config';
import { registerDoctor } from './commands/doctor';
import { registerInit } from './commands/init';
import { registerList } from './commands/list';
import { registerPath } from './commands/path';
import { registerRemove } from './commands/remove';
import { registerSetup } from './commands/setup';
import { registerStatus } from './commands/status';
import { registerSync } from './commands/sync';
import type { CliContext } from './context';
import { type GlobalOptions, defaultGlobalOptions } from './options';

function parseGlobalOpts(values: OptionValues): GlobalOptions {
  const json = Boolean(values.json);
  const color = (values.color as ColorMode) ?? 'auto';
  const quiet = Boolean(values.quiet);
  const verbose = Boolean(values.verbose);
  if (json && color === 'always') {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      '--json and --color=always cannot be combined',
      EXIT_CODE.USAGE,
    );
  }
  if (quiet && verbose) {
    throw new GhqvError(
      'GHQV_USAGE_ERROR',
      '--quiet and --verbose cannot be combined',
      EXIT_CODE.USAGE,
    );
  }
  return {
    workspace: typeof values.workspace === 'string' ? values.workspace : undefined,
    workspaceRoot: typeof values.workspaceRoot === 'string' ? values.workspaceRoot : undefined,
    json,
    color,
    quiet,
    verbose,
  };
}

function buildContext(opts: GlobalOptions): CliContext {
  const runner = new BunProcessRunner();
  const git = new GitProcessClient(runner);
  const colors = createColors(opts.color, process.stderr.isTTY ?? false);
  const stderr = (msg: string) => {
    if (opts.quiet) return;
    if (opts.json) return; // suppress human stderr in json mode except errors handled elsewhere
    process.stderr.write(`${msg}\n`);
  };
  const stdout = (msg: string) => {
    if (opts.quiet) return;
    process.stdout.write(`${msg}\n`);
  };
  return {
    options: opts,
    fs: new NodeFileSystem(),
    process: runner,
    ghq: new GhqProcessClient(runner),
    git,
    manifest: new YamlManifestStore(),
    state: new JsonStateStore(git),
    lock: new FileLockManager(),
    config: new GitConfigStore(runner, homedir()),
    colors,
    home: homedir(),
    cwd: resolve(process.cwd()),
    stderr,
    stdout,
  };
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('ghqv')
    .description('Virtual monorepo workspace manager for ghq-managed repositories')
    .version(versionString())
    .option('-w, --workspace <name-or-path>', 'target workspace')
    .option('--workspace-root <path>', 'workspace root directory')
    .option('--json', 'emit JSON on stdout')
    .option('--color <mode>', 'color output', 'auto')
    .option('-q, --quiet', 'suppress non-essential output')
    .option('-v, --verbose', 'show verbose diagnostics');

  const mkCtx = async (): Promise<CliContext> => {
    const opts = parseGlobalOpts(program.opts());
    return buildContext(opts);
  };

  registerInit(program, mkCtx);
  registerClone(program, mkCtx);
  registerAdd(program, mkCtx);
  registerRemove(program, mkCtx);
  registerSync(program, mkCtx);
  registerStatus(program, mkCtx);
  registerList(program, mkCtx);
  registerPath(program, mkCtx);
  registerDoctor(program, mkCtx);
  registerConfig(program, mkCtx);
  registerSetup(program, mkCtx);

  return program;
}

export function versionString(): string {
  return `ghqv ${VERSION} (commit ${COMMIT}, built ${BUILD_DATE}, bun ${Bun.version}, ${process.platform}/${process.arch})`;
}

export async function run(argv: string[]): Promise<number> {
  const program = createProgram();
  program.exitOverride();
  let commandName = 'ghqv';
  try {
    const sub = argv.find((a) => !a.startsWith('-'));
    if (sub) commandName = sub;
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (e) {
    let opts: GlobalOptions;
    try {
      opts = parseGlobalOpts(program.opts());
    } catch {
      opts = defaultGlobalOptions();
    }
    if (isCommanderError(e)) {
      // commander already wrote --help / --version output to stdout for these codes.
      if (
        e.code === 'commander.version' ||
        e.code === 'commander.helpDisplayed' ||
        e.code === 'commander.help'
      ) {
        return 0;
      }
      if (opts.json) {
        emitJson(errorEnvelope(commandName, 'GHQV_USAGE_ERROR', e.message));
      } else {
        process.stderr.write(`error: ${e.message}\n`);
      }
      return (e as { exitCode?: number }).exitCode ?? EXIT_CODE.USAGE;
    }
    if (e instanceof GhqvError) {
      if (opts.json) {
        emitJson(errorEnvelope(commandName, e.code, e.message, e.hint, e.details));
      } else {
        process.stderr.write(`error: ${e.message}\n`);
        if (e.hint) process.stderr.write(`hint: ${e.hint}\n`);
        if (opts.verbose && e.cause) {
          process.stderr.write(`cause: ${String((e as Error & { cause?: unknown }).cause)}\n`);
        }
      }
      return e.exitCode;
    }
    if (opts.json) {
      emitJson(errorEnvelope(commandName, 'GHQV_INTERNAL_ERROR', (e as Error).message));
    } else {
      process.stderr.write(`error: ${(e as Error).message}\n`);
      if (opts.verbose) process.stderr.write(`${(e as Error).stack ?? ''}\n`);
    }
    void internalError;
    return EXIT_CODE.INTERNAL_ERROR;
  }
}

function isCommanderError(e: unknown): e is CommanderError {
  return e instanceof CommanderError;
}
