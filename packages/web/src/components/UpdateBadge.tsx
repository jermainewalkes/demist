import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { UpdateStatus } from '../types';

const COMMANDS: Record<string, { label: string; command: string }> = {
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
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    api.updateStatus().then(setStatus).catch(() => {});
  }, []);

  // Dismiss on Escape or a click outside the badge.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!status?.updateAvailable) return null;
  // Unknown install mode (shouldn't happen) degrades to notes + release link only.
  const cmd = COMMANDS[status.installMode];

  async function copy() {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the command is selectable text anyway */
    }
  }

  return (
    <span className="update-badge" ref={ref}>
      <button className="update-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Update available: {status.latest}
      </button>
      {open && (
        <div className="update-panel">
          <h3>
            {status.current} → {status.latest}
          </h3>
          {status.notes && <pre className="update-notes">{status.notes}</pre>}
          {cmd && (
            <>
              <p className="hint">{cmd.label}</p>
              <div className="update-command">
                <code>{cmd.command}</code>
                <button className="link" onClick={copy}>
                  {copied ? 'copied ✓' : 'copy'}
                </button>
              </div>
            </>
          )}
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
