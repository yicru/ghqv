import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface IntegrationEnv {
  tmp: string;
  home: string;
  ghqRoot: string;
  remotes: string;
  workspaces: string;
  bin: string;
  cleanup: () => Promise<void>;
  env: Record<string, string>;
}

export async function setupEnv(): Promise<IntegrationEnv> {
  const tmp = await mkdtemp(join(tmpdir(), 'ghqv-it-'));
  const home = join(tmp, 'home');
  const ghqRoot = join(tmp, 'ghq-root');
  const remotes = join(tmp, 'remotes');
  const workspaces = join(tmp, 'workspaces');
  const bin = join(tmp, 'bin');
  await mkdir(home, { recursive: true });
  await mkdir(ghqRoot, { recursive: true });
  await mkdir(remotes, { recursive: true });
  await mkdir(workspaces, { recursive: true });
  await mkdir(bin, { recursive: true });

  // install fake ghq
  const fakeGhq = join(bin, 'ghq');
  const script = `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  --version) echo "ghq fake 1.0.0" ;;
  root) echo "\${GHQ_ROOT:?}" ;;
  get)
    src="\${2:?}"; dest="\${GHQ_ROOT}/\${src}"
    if [ -d "\$dest" ]; then exit 0; fi
    remote="\${REMOTES}/\${src//\\//__}.git"
    mkdir -p "\$(dirname "\$dest")"
    git clone --quiet "\$remote" "\$dest" >&2
    ;;
  list)
    shift
    src=""
    while [ \$# -gt 0 ]; do
      case "\$1" in --full-path|--exact) shift ;; *) src="\$1"; shift ;; esac
    done
    dest="\${GHQ_ROOT}/\${src}"
    if [ -d "\$dest" ]; then echo "\$dest"; fi
    ;;
  *) echo "fake-ghq: unsupported: \$*" >&2; exit 1 ;;
esac
`;
  await writeFile(fakeGhq, script, { mode: 0o755 });
  await chmod(fakeGhq, 0o755);

  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    GHQ_ROOT: ghqRoot,
    REMOTES: remotes,
    GHQV_WORKSPACE_ROOT: workspaces,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
  } as Record<string, string>;

  return {
    tmp,
    home,
    ghqRoot,
    remotes,
    workspaces,
    bin,
    env,
    cleanup: async () => {
      await rm(tmp, { recursive: true, force: true });
    },
  };
}

export async function createRemoteBare(env: IntegrationEnv, source: string): Promise<void> {
  // source: host/ns/repo
  const name = source.replace(/\//g, '__');
  const barePath = join(env.remotes, `${name}.git`);
  spawnSync('git', ['init', '--bare', '--quiet', barePath], { env: env.env, stdio: 'ignore' });
  // create a working repo, commit, push
  const work = join(env.tmp, 'work', name);
  await mkdir(work, { recursive: true });
  spawnSync('git', ['init', '--quiet', work], { env: env.env, stdio: 'ignore' });
  spawnSync('git', ['-C', work, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  spawnSync('git', ['-C', work, 'config', 'user.name', 't'], { stdio: 'ignore' });
  await writeFile(join(work, 'README.md'), `# ${source}\n`, 'utf8');
  spawnSync('git', ['-C', work, 'add', '.'], { env: env.env, stdio: 'ignore' });
  spawnSync('git', ['-C', work, 'commit', '--quiet', '-m', 'init'], {
    env: env.env,
    stdio: 'ignore',
  });
  spawnSync('git', ['-C', work, 'remote', 'add', 'origin', barePath], {
    env: env.env,
    stdio: 'ignore',
  });
  spawnSync('git', ['-C', work, 'push', '--quiet', 'origin', 'HEAD'], {
    env: env.env,
    stdio: 'ignore',
  });
}

/** Pre-clone a source into the ghq root (simulate an existing checkout). */
export function preCheckout(env: IntegrationEnv, source: string): void {
  const name = source.replace(/\//g, '__');
  const barePath = join(env.remotes, `${name}.git`);
  const dest = join(env.ghqRoot, source);
  spawnSync('mkdir', ['-p', join(env.ghqRoot, ...source.split('/').slice(0, -1))], {
    env: env.env,
    stdio: 'ignore',
  });
  spawnSync('git', ['clone', '--quiet', barePath, dest], { env: env.env, stdio: 'ignore' });
}
