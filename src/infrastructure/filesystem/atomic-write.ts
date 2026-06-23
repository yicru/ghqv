import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeTextAtomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const handle = await open(tmp, 'w', mode ?? 0o644);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    throw e;
  }
}
