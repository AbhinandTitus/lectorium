import { useEffect, useState } from "react";
import { identity } from "../config/identity";
import { useLibrary } from "../state/library";
import * as data from "../services/data";
import * as cp from "../services/commonplace";
import { inTauri } from "../services/library";
import "./settings.css";

/**
 * Settings sheet (docs/PRODUCT.md — Settings is a sheet, not a fifth
 * destination). Data safety and night behavior live here.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useLibrary();
  const [backups, setBackups] = useState<data.BackupInfo[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<data.BackupInfo | null>(null);

  useEffect(() => {
    void data.listBackups().then(setBackups);
  }, []);

  const refresh = () => void data.listBackups().then(setBackups);

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings" onClick={onClose}>
      <aside className="settings-sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <section>
          <h3>Night</h3>
          <label className="settings-row">
            <span>Target bedtime</span>
            <input
              type="time"
              value={settings.bedtime ?? ""}
              onChange={(e) => void updateSettings({ bedtime: e.target.value || null })}
              aria-label="Target bedtime"
            />
          </label>
          <p className="settings-hint">
            During the wind-down hour before this time, {identity.name} enters Quiet Night: warm and
            dark, with decorative motion frozen. For the lowest sleep impact, use paper or e-ink
            near bedtime and keep a dim warm lamp with low hardware brightness.
          </p>
        </section>

        <section>
          <h3>Reading</h3>
          <label className="settings-row settings-check">
            <input
              type="checkbox"
              checked={settings.directResume}
              onChange={(e) => void updateSettings({ directResume: e.target.checked })}
            />
            <span>Open my most recent book on launch (direct resume)</span>
          </label>
        </section>

        <section>
          <h3>Your data</h3>
          <p className="settings-hint">
            Everything stays on this computer. Backups and exports never copy your book files.
          </p>
          <div className="settings-actions">
            <button
              onClick={() =>
                void cp.exportCommonplace().then((dir) => dir && setNote(`Exported to ${dir}`))
              }
            >
              Export commonplace
            </button>
            <button
              onClick={() =>
                void data.importReadingData().then((r) => {
                  if (r)
                    setNote(
                      `Imported ${r.importedEntries} entries, ${r.importedVocabulary} words` +
                        (r.skippedNoBook || r.skippedDuplicate
                          ? ` (skipped ${r.skippedNoBook} without a matching book, ${r.skippedDuplicate} duplicates)`
                          : ""),
                    );
                })
              }
            >
              Import reading data
            </button>
            <button
              onClick={() =>
                void data.backupNow().then((p) => {
                  setNote(`Backed up to ${p}`);
                  refresh();
                })
              }
            >
              Back up now
            </button>
          </div>

          {backups.length > 0 && (
            <div className="settings-backups">
              <p className="settings-hint">
                Restore from a backup (your current data is backed up first):
              </p>
              <ul>
                {backups.slice(0, 6).map((b) => (
                  <li key={b.path}>
                    <button onClick={() => inTauri() && setRestoreCandidate(b)}>
                      {b.name} · {(b.bytes / 1024).toFixed(0)} KB
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {restoreCandidate && (
            <div className="settings-confirm" role="alertdialog" aria-modal="true">
              <p>
                Restore <strong>{restoreCandidate.name}</strong>? Your current data will be backed
                up first, then replaced.
              </p>
              <div>
                <button onClick={() => setRestoreCandidate(null)}>Cancel</button>
                <button
                  onClick={() => {
                    const candidate = restoreCandidate;
                    setRestoreCandidate(null);
                    void data.restoreBackup(candidate.path).then(() => {
                      setNote("Restored. Reopen a book to continue.");
                      void useLibrary.getState().bootstrap();
                    });
                  }}
                >
                  Restore backup
                </button>
              </div>
            </div>
          )}
        </section>

        {note && (
          <p className="settings-note" role="status">
            {note}
          </p>
        )}
      </aside>
    </div>
  );
}
