import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rmdir,
  symlink,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FileEntry, FileSystem } from '../../application/ports';
import { writeTextAtomic } from './atomic-write';

export class NodeFileSystem implements FileSystem {
  async lstat(path: string): Promise<FileEntry | null> {
    try {
      const st = await lstat(path);
      if (st.isSymbolicLink()) {
        let target: string | undefined;
        try {
          target = await readlink(path);
        } catch {
          target = undefined;
        }
        return { kind: 'symlink', symlinkTarget: target, exists: true };
      }
      if (st.isFile()) return { kind: 'file', exists: true };
      if (st.isDirectory()) return { kind: 'directory', exists: true };
      return { kind: 'other', exists: true };
    } catch {
      return null;
    }
  }

  async realpath(path: string): Promise<string> {
    return realpath(path);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path);
  }

  async mkdirAll(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async symlink(target: string, path: string): Promise<void> {
    await symlink(target, path);
  }

  async readlink(path: string): Promise<string> {
    return readlink(path);
  }

  async unlink(path: string): Promise<void> {
    await unlink(path);
  }

  async rmdir(path: string): Promise<void> {
    await rmdir(path);
  }

  async readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async writeTextAtomic(path: string, content: string, mode?: number): Promise<void> {
    await writeTextAtomic(path, content, mode);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.lstat(path)) !== null;
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(path);
  }
}

export { resolve };
