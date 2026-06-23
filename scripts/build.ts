import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const targets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64-baseline',
  'bun-linux-arm64',
] as const;

const dist = join(import.meta.dir, '..', 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const version = process.env.GHQV_VERSION ?? '0.0.0-dev';
const commit = process.env.GHQV_COMMIT ?? 'unknown';
const buildDate = process.env.GHQV_BUILD_DATE ?? new Date().toISOString();

const built: { archive: string; sha256: string }[] = [];

for (const target of targets) {
  const result = await Bun.build({
    entrypoints: ['./src/index.ts'],
    minify: true,
    sourcemap: 'none',
    define: {
      GHQV_VERSION: JSON.stringify(version),
      GHQV_COMMIT: JSON.stringify(commit),
      GHQV_BUILD_DATE: JSON.stringify(buildDate),
    },
    compile: {
      target,
      outfile: `./dist/${target}/ghqv`,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exitCode = 1;
    continue;
  }

  // smoke test the binary (only for the native target)
  const isNative =
    target === `bun-${process.platform}-${process.arch}` ||
    (process.platform === 'linux' && process.arch === 'x64' && target === 'bun-linux-x64-baseline');
  if (isNative) {
    const smoke = Bun.spawn([join(dist, target, 'ghqv'), '--version'], {
      cwd: dist,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const smokeOut = await Bun.readableStreamToText(smoke.stdout);
    await smoke.exited;
    if (!smokeOut.includes(version)) {
      console.error(`smoke test failed for ${target}: ${smokeOut}`);
      process.exitCode = 1;
      continue;
    }
  } else {
    console.log(`skipped smoke test for non-native target ${target}`);
  }

  // package archive
  const stage = join(dist, target, 'stage');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(join(dist, target, 'ghqv'), join(stage, 'ghqv'));
  const repoRoot = join(import.meta.dir, '..');
  for (const f of ['README.md', 'LICENSE']) {
    try {
      await cp(join(repoRoot, f), join(stage, f));
    } catch {
      // optional file
    }
  }

  const archiveBase = `ghqv_${version}_${target.replace('bun-', '').replace('-baseline', '')}`;
  const tarPath = join(dist, `${archiveBase}.tar.gz`);
  const tarFiles: string[] = ['ghqv'];
  for (const f of ['README.md', 'LICENSE']) {
    try {
      await readFile(join(stage, f));
      tarFiles.push(f);
    } catch {
      // skip absent optional file
    }
  }
  const tar = Bun.spawn(['tar', '-czf', tarPath, '-C', stage, ...tarFiles], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await tar.exited;
  const digest = createHash('sha256')
    .update(await readFile(tarPath))
    .digest('hex');
  built.push({ archive: `${archiveBase}.tar.gz`, sha256: digest });
}

// checksums.txt
const checksums = `${built.map((b) => `${b.sha256}  ${b.archive}`).join('\n')}\n`;
await writeFile(join(dist, 'checksums.txt'), checksums);
console.log(checksums);
