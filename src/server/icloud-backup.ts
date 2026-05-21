import { existsSync } from 'node:fs';
import type { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface Fs {
  readdir: typeof readdir;
  mkdir: typeof mkdir;
  stat: typeof stat;
  copyFile: typeof copyFile;
  rm: typeof rm;
}

async function mirrorAlbumsToLatest(
  localAlbums: string,
  latestDir: string,
  fs: Pick<Fs, 'readdir' | 'mkdir' | 'stat' | 'copyFile'>
): Promise<void> {
  const albums = await fs.readdir(localAlbums, { withFileTypes: true });
  await Promise.all(
    albums
      .filter((e) => e.isDirectory())
      .map(async (entry) => {
        const srcDir = join(localAlbums, entry.name);
        const destDir = join(latestDir, entry.name);
        await fs.mkdir(destDir, { recursive: true });
        const files = await fs.readdir(srcDir);
        await Promise.all(
          files.map(async (file) => {
            const src = join(srcDir, file);
            const dest = join(destDir, file);
            try {
              const srcStat = await fs.stat(src);
              let needsCopy = true;
              try {
                const destStat = await fs.stat(dest);
                needsCopy = srcStat.mtimeMs > destStat.mtimeMs;
              } catch {
                /* dest doesn't exist */
              }
              if (needsCopy) await fs.copyFile(src, dest);
            } catch {
              /* skip unreadable files */
            }
          })
        );
      })
  );
}

async function createDailySnapshot(
  latestDir: string,
  todaySnapshot: string,
  fs: Pick<Fs, 'readdir' | 'mkdir' | 'copyFile'>
): Promise<void> {
  const latestAlbums = await fs.readdir(latestDir, { withFileTypes: true });
  await Promise.all(
    latestAlbums
      .filter((e) => e.isDirectory())
      .map(async (entry) => {
        const srcDir = join(latestDir, entry.name);
        const destDir = join(todaySnapshot, entry.name);
        await fs.mkdir(destDir, { recursive: true });
        const files = await fs.readdir(srcDir);
        await Promise.all(
          files.map(async (file) => {
            await fs.copyFile(join(srcDir, file), join(destDir, file));
          })
        );
      })
  );
}

async function pruneOldSnapshots(
  snapshotsDir: string,
  fs: Pick<Fs, 'readdir' | 'rm'>
): Promise<void> {
  try {
    const snapshots = await fs.readdir(snapshotsDir);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    await Promise.all(
      snapshots
        .filter((name) => name < cutoffStr)
        .map(async (name) => {
          await fs.rm(join(snapshotsDir, name), { recursive: true });
        })
    );
  } catch {
    /* no snapshots dir yet */
  }
}

export async function backupAlbumsToICloud(dataDir: string): Promise<void> {
  const icloudBase = join(
    process.env.HOME!,
    'Library/Mobile Documents/com~apple~CloudDocs'
  );
  if (!existsSync(icloudBase)) return;

  const localAlbums = join(dataDir, 'albums');
  if (!existsSync(localAlbums)) return;

  const backupRoot = join(icloudBase, 'Karttapallo');
  const latestDir = join(backupRoot, 'latest');
  const snapshotsDir = join(backupRoot, 'snapshots');
  const fs = await import('node:fs/promises');

  await mirrorAlbumsToLatest(localAlbums, latestDir, fs);

  const today = new Date().toISOString().slice(0, 10);
  const todaySnapshot = join(snapshotsDir, today);
  if (!existsSync(todaySnapshot)) {
    await createDailySnapshot(latestDir, todaySnapshot, fs);
  }

  await pruneOldSnapshots(snapshotsDir, fs);

  console.log('[main] Albums backed up to iCloud');
}
