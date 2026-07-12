import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpdateStatus } from '../types';

const COMMANDS: Record<UpdateStatus['installMode'], { label: string; command: string }> = {
  docker: {
    label: 'Pull the new image and recreate the container:',
    command: 'docker compose pull && docker compose up -d',
  },
  git: {
    label: 'Update your checkout and rebuild:',
    command: 'git pull && npm install && npm run build',
  },
  package: {
    label: 'Update the installed package:',
    command: 'npm install -g demist@latest',
  },
};

/**
 * Quiet update indicator: a topbar pill that only exists when a newer release
 * is known, expanding to the release notes and the exact update commands for
 * this install (applying updates is the platform's job, not the app's).
 */
export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.updateStatus().then(setStatus).catch(() => {});
  }, []);

  if (!status?.updateAvailable) return null;
  const { label, command } = COMMANDS[status.installMode];

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the command is selectable text anyway */
    }
  }

  return (
    <span className="update-badge">
      <button className="update-pill" onClick={() => setOpen((o) => !o)}>
        Update available: {status.latest}
      </button>
      {open && (
        <div className="update-panel">
          <h3>
            {status.current} → {status.latest}
          </h3>
          {status.notes && <pre className="update-notes">{status.notes}</pre>}
          <p className="hint">{label}</p>
          <div className="update-command">
            <code>{command}</code>
            <button className="link" onClick={copy}>
              {copied ? 'copied ✓' : 'copy'}
            </button>
          </div>
          {status.installMode === 'docker' && (
            <p className="hint">
              Tip: run{' '}
              <a href="https://containrrr.dev/watchtower/" target="_blank" rel="noopener noreferrer">
                Watchtower
              </a>{' '}
              alongside Demist for unattended updates.
            </p>
          )}
          {status.url && (
            <p className="hint">
              <a href={status.url} target="_blank" rel="noopener noreferrer">
                View the release on GitHub →
              </a>
            </p>
          )}
        </div>
      )}
    </span>
  );
}
