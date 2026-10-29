import { useCallback, useEffect, useState } from 'react';
import { getMeta, setMeta } from '../db';
import { buildExport, LAST_EXPORT_KEY } from './exportImport';

/*
 * Automatic backup: every few days, write the JSON export into a folder the user chose
 * (ideally on another disk or a synced folder), keeping the most recent few files.
 * Photos aren't in the file, only where they are (they stay in their folders / Drive).
 */

const HANDLE_KEY = 'backup.folder';
const SETTINGS_KEY = 'backup.settings';
const FILE_RE = /^people-backup-.*\.json$/;

export interface BackupSettings {
  everyDays: number;
  keep: number;
}
export const DEFAULT_BACKUP: BackupSettings = { everyDays: 3, keep: 10 };

export interface BackupState {
  folder?: FileSystemDirectoryHandle;
  settings: BackupSettings;
  lastAt?: string;
  /** Due, but Chrome needs a click to allow writing to the folder again. */
  needsClick: boolean;
}

async function writePermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!request || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

const stamp = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

/** Writes one backup file now and prunes old ones. Returns the file name. */
async function writeBackup(folder: FileSystemDirectoryHandle, keep: number): Promise<string> {
  const data = await buildExport();
  const name = `people-backup-${stamp(new Date())}.json`;
  const fh = await folder.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
  await setMeta(LAST_EXPORT_KEY, data.exportedAt);

  // Keep only the newest \`keep\` backups (names sort by date).
  const existing: string[] = [];
  for await (const e of folder.values()) if (e.kind === 'file' && FILE_RE.test(e.name)) existing.push(e.name);
  existing.sort().reverse();
  for (const old of existing.slice(keep)) await folder.removeEntry(old).catch(() => {});
  return name;
}

const isDue = (lastAt: string | undefined, everyDays: number) => !lastAt || Date.now() - new Date(lastAt).getTime() >= everyDays * 864e5;

export function useAutoBackup(onBackedUp: (file: string) => void) {
  const [state, setState] = useState<BackupState>({ settings: DEFAULT_BACKUP, needsClick: false });

  const load = useCallback(async () => {
    const [folder, settings, lastAt] = await Promise.all([
      getMeta<FileSystemDirectoryHandle>(HANDLE_KEY),
      getMeta<BackupSettings>(SETTINGS_KEY),
      getMeta<string>(LAST_EXPORT_KEY),
    ]);
    const s = { ...DEFAULT_BACKUP, ...settings };
    let needsClick = false;
    let last = lastAt;
    if (folder && isDue(lastAt, s.everyDays)) {
      if (await writePermission(folder, false)) {
        try {
          const file = await writeBackup(folder, s.keep);
          last = await getMeta<string>(LAST_EXPORT_KEY);
          onBackedUp(file);
        } catch {
          needsClick = true; // e.g. the folder's disk is unplugged; offer to retry
        }
      } else {
        needsClick = true;
      }
    }
    setState({ folder, settings: s, lastAt: last, needsClick });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check at start and every hour while the app is open.
  useEffect(() => {
    load();
    const t = window.setInterval(load, 3600_000);
    return () => clearInterval(t);
  }, [load]);

  /** Click handler: ask for write access if needed, then back up now. */
  const backUpNow = useCallback(async (): Promise<string> => {
    const folder = state.folder;
    if (!folder) throw new Error('Choose a backup folder first');
    if (!(await writePermission(folder, true))) throw new Error('Chrome didn’t allow writing to the backup folder');
    const file = await writeBackup(folder, state.settings.keep);
    await load();
    return file;
  }, [state.folder, state.settings.keep, load]);

  /** Click handler: pick the folder (needs write access). */
  const chooseFolder = useCallback(async (): Promise<boolean> => {
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('Automatic backup needs Chrome or Edge');
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'people-backup' });
    } catch {
      return false; // cancelled
    }
    await setMeta(HANDLE_KEY, handle);
    await load();
    return true;
  }, [load]);

  const saveSettings = useCallback(
    async (s: BackupSettings) => {
      await setMeta(SETTINGS_KEY, s);
      await load();
    },
    [load],
  );

  const turnOff = useCallback(async () => {
    await setMeta(HANDLE_KEY, undefined);
    await load();
  }, [load]);

  return { ...state, backUpNow, chooseFolder, saveSettings, turnOff };
}

export type AutoBackup = ReturnType<typeof useAutoBackup>;
