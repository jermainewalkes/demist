import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SpecDiff } from '../types';

interface Props {
  apiId: string;
  apiName: string;
  /** Called after the workspace copy is updated to the latest spec. */
  onRefreshed: () => void;
}

/** Compare the workspace's cached spec against a fresh fetch of the same URL. */
export function SpecDiffView({ apiId, apiName, onRefreshed }: Props) {
  const [diff, setDiff] = useState<SpecDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setDiff(null);
    setError(null);
    api.diffApi(apiId).then(setDiff).catch((e) => setError((e as Error).message));
  }, [apiId]);

  async function update() {
    setUpdating(true);
    try {
      await api.refreshApi(apiId);
      onRefreshed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!diff) return <div className="empty">Fetching the latest spec and comparing…</div>;

  return (
    <div className="spec-diff">
      <h2>Spec changes — {apiName}</h2>
      <p className="hint">
        workspace copy <code>{diff.oldVersion || '(no version)'}</code> vs upstream{' '}
        <code>{diff.newVersion || '(no version)'}</code>
      </p>

      {diff.identical ? (
        <div className="banner ok">No changes — your workspace copy matches upstream.</div>
      ) : (
        <>
          {diff.added.length > 0 && (
            <section>
              <h3>Added ({diff.added.length})</h3>
              {diff.added.map((o) => (
                <div key={`${o.method} ${o.path}`} className="diff-row added">
                  <span className={`method ${o.method.toLowerCase()}`}>{o.method}</span>
                  <code>{o.path}</code>
                  <span className="leaf-summary">{o.summary}</span>
                </div>
              ))}
            </section>
          )}
          {diff.removed.length > 0 && (
            <section>
              <h3>Removed ({diff.removed.length})</h3>
              {diff.removed.map((o) => (
                <div key={`${o.method} ${o.path}`} className="diff-row removed">
                  <span className={`method ${o.method.toLowerCase()}`}>{o.method}</span>
                  <code>{o.path}</code>
                </div>
              ))}
            </section>
          )}
          {diff.changed.length > 0 && (
            <section>
              <h3>Changed ({diff.changed.length})</h3>
              {diff.changed.map((c) => (
                <div key={`${c.method} ${c.path}`} className="diff-row changed">
                  <div>
                    <span className={`method ${c.method.toLowerCase()}`}>{c.method}</span>
                    <code>{c.path}</code>
                  </div>
                  <ul className="diff-notes">
                    {c.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {(diff.schemesAdded.length > 0 || diff.schemesRemoved.length > 0) && (
            <p className="hint">
              Auth schemes:{' '}
              {diff.schemesAdded.map((s) => `+${s}`).join(' ')}{' '}
              {diff.schemesRemoved.map((s) => `−${s}`).join(' ')}
            </p>
          )}
          {diff.serversChanged && (
            <p className="hint">
              Servers: {diff.serversChanged.old.join(', ')} → {diff.serversChanged.new.join(', ')}
            </p>
          )}
          <div className="send-row">
            <button className="send" onClick={update} disabled={updating}>
              {updating ? 'Updating…' : 'Update workspace to latest'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
