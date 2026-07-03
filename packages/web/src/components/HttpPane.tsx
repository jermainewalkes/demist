import { useState } from 'react';
import type { ExecuteResult } from '../types';

interface Props {
  preview: string;
  previewError: string | null;
  result: ExecuteResult | null;
  /** Present when a JSON response can be mined for variables (chaining). */
  onExtract?: (path: string, varName: string) => Promise<string>;
}

/**
 * The de-mystifying pane: the exact request demist will send (live preview),
 * and the full exchange once sent. Secrets arrive pre-masked from the server.
 */
export function HttpPane({ preview, previewError, result, onExtract }: Props) {
  const [tab, setTab] = useState<'pretty' | 'raw'>('pretty');
  const response = result?.response;

  let prettyBody: string | null = null;
  if (response) {
    try {
      prettyBody = JSON.stringify(JSON.parse(response.bodyText), null, 2);
    } catch {
      prettyBody = null;
    }
  }

  return (
    <div className="http-pane">
      <section>
        <h3>Request {result ? '(as sent)' : '(live preview)'}</h3>
        {previewError ? (
          <div className="banner warn small">{previewError}</div>
        ) : (
          <pre className="transcript">{result?.request.raw ?? preview ?? ''}</pre>
        )}
      </section>

      {result?.error && <div className="banner error">{result.error}</div>}

      {response && (
        <section>
          <h3>
            Response{' '}
            <span className={`status s${Math.floor(response.status / 100)}xx`}>
              {response.status} {response.statusText}
            </span>
            <span className="timing">{response.timeMs} ms</span>
            <span className="tabs">
              <button
                className={`link ${tab === 'pretty' ? 'active' : ''}`}
                onClick={() => setTab('pretty')}
              >
                pretty
              </button>
              <button
                className={`link ${tab === 'raw' ? 'active' : ''}`}
                onClick={() => setTab('raw')}
              >
                raw
              </button>
            </span>
          </h3>
          {tab === 'raw' ? (
            <pre className="transcript">{response.raw}</pre>
          ) : (
            <pre className="transcript">{prettyBody ?? response.bodyText}</pre>
          )}
          {response.truncated && (
            <div className="banner warn small">Response truncated at 2 MB</div>
          )}
          {onExtract && prettyBody !== null && <ExtractForm onExtract={onExtract} />}
        </section>
      )}
    </div>
  );
}

/** Pull a value out of the response into a workspace variable — chain it into the next request. */
function ExtractForm({ onExtract }: { onExtract: (path: string, varName: string) => Promise<string> }) {
  const [path, setPath] = useState('');
  const [varName, setVarName] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function extract() {
    try {
      const value = await onExtract(path.trim(), varName.trim());
      setStatus(`Saved {{var.${varName.trim()}}} = ${value.length > 60 ? value.slice(0, 60) + '…' : value}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="extract-form">
      <span className="extract-label">extract</span>
      <input placeholder="path, e.g. items[0].id" value={path} onChange={(e) => setPath(e.target.value)} />
      <span className="extract-label">into</span>
      <input placeholder="variable name" value={varName} onChange={(e) => setVarName(e.target.value)} />
      <button onClick={extract} disabled={!path.trim() || !varName.trim()}>
        →
      </button>
      {status && <div className="hint extract-status">{status}</div>}
    </div>
  );
}
