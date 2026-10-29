import { useState } from 'react';
import { applyImport, parseImport, type ImportMode } from '../lib/exportImport';
import type { ExportFile } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toasts';

/** Validates the file first, shows what's in it, then merges or replaces (FR-51, NFR-09). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<ExportFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');

  async function read(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setFile(null);
    setError(null);
    try {
      setFile(parseImport(await f.text()));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    if (!file) return;
    const undo = await applyImport(file, mode);
    onClose();
    toast(`Imported ${file.people.length.toLocaleString()} people (${mode})`, { undo });
  }

  return (
    <Modal
      title="Import data"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!file} onClick={run}>
            Import
          </button>
        </>
      }
    >
      <label className="field">
        <span>Export file (.json)</span>
        <input className="input" type="file" accept="application/json,.json" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {error && (
        <p className="notice notice-error">
          {fileName}: {error} Nothing was changed.
        </p>
      )}
      {file && (
        <>
          <p className="notice">
            {file.people.length.toLocaleString()} people, {file.labels.length} labels, {file.labelGroups.length} groups — exported{' '}
            {new Date(file.exportedAt).toLocaleString()}.
          </p>
          <fieldset className="field radio-set">
            <legend>How to import</legend>
            <label>
              <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <strong>Merge</strong> — add new
              people, update ones with the same id, keep the rest
            </label>
            <label>
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> <strong>Replace</strong> — delete
              current people and labels first
            </label>
          </fieldset>
        </>
      )}
    </Modal>
  );
}
