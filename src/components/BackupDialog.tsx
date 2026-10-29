import { useState } from 'react';
import { FolderOpen, HardDriveDownload } from 'lucide-react';
import type { AutoBackup } from '../lib/autoBackup';
import { Modal } from './Modal';
import { useToast } from './Toasts';

/** Settings for the automatic backup: folder, how often, how many files to keep. */
export function BackupDialog({ backup, onClose }: { backup: AutoBackup; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Automatic backup" onClose={onClose}>
      <p>
        Every few days the app saves a backup file (people, labels, links, notes and photo locations) into a folder you choose. Pick a
        folder on another disk or a synced folder (OneDrive, Google Drive for desktop) so a backup survives if this browser’s data is
        cleared. Photos themselves stay where they are.
      </p>

      <div className="backup-folder">
        <FolderOpen size={18} />
        <span className="grow">{backup.folder ? <strong>{backup.folder.name}</strong> : <span className="muted">No folder chosen — backup is off</span>}</span>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(backup.chooseFolder)}>
          {backup.folder ? 'Change folder' : 'Choose folder'}
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Back up every</span>
          <select
            className="input select"
            value={backup.settings.everyDays}
            onChange={(e) => run(() => backup.saveSettings({ ...backup.settings, everyDays: Number(e.target.value) }))}
          >
            {[1, 3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? 'day' : `${d} days`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Keep the newest</span>
          <select
            className="input select"
            value={backup.settings.keep}
            onChange={(e) => run(() => backup.saveSettings({ ...backup.settings, keep: Number(e.target.value) }))}
          >
            {[5, 10, 30].map((n) => (
              <option key={n} value={n}>
                {n} files
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="muted small">
        Last backup: {backup.lastAt ? new Date(backup.lastAt).toLocaleString() : 'never'}. To restore, use ⋮ → Import JSON and pick a backup
        file.
      </p>

      <div className="row-gap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!backup.folder || busy}
          onClick={() => run(async () => toast(`Backed up to ${await backup.backUpNow()}`))}
        >
          <HardDriveDownload size={16} /> Back up now
        </button>
        {backup.folder && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(backup.turnOff)}>
            Turn off
          </button>
        )}
      </div>
    </Modal>
  );
}
