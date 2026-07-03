import { useEffect, useMemo, useState } from 'react';
import { JsonTree } from './JsonTree';
import type { ExecuteResult } from '../types';

interface Props {
  preview: string;
  previewError: string | null;
  result: ExecuteResult | null;
  /** Present when a JSON response can be mined for variables (chaining). */
  onExtract?: (path: string, varName: string) => Promise<string>;
}

/** Beyond this, skip the interactive tree — a flat <pre> stays fast. */
const MAX_TREE_BYTES = 400_000;

/**
 * The de-mystifying pane: the exact request demist will send (live preview),
 * and the full exchange once sent. Secrets arrive pre-masked from the server.
 * JSON responses render as a clickable tree: clicking a key fills the extract
 * path below — click the data you can see, get the path.
 */
export function HttpPane({ preview, previewError, result, onExtract }: Props) {
  const [tab, setTab] = useState<'pretty' | 'raw'>('pretty');
  const [extractPath, setExtractPath] = useState('');
  const [varName, setVarName] = useState('');
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const response = result?.response;

  // A fresh exchange invalidates the previous extraction status line.
  useEffect(() => setExtractStatus(null), [response]);

  const parsed = useMemo(() => {
    if (!response || response.bodyText.length > MAX_TREE_BYTES) return undefined;
    try {
      return { value: JSON.parse(response.bodyText) as unknown };
    } catch {
      return undefined;
    }
  }, [response]);

  function pickPath(path: string) {
    setExtractPath(path);
    setExtractStatus(null);
    if (varName === '') {
      const segments = path.match(/[^.[\]"]+/g);
      const last = segments?.[segments.length - 1] ?? '';
      const name = last.replace(/[^A-Za-z0-9_.-]/g, '_');
      if (name !== '' && !/^\d+$/.test(name)) setVarName(name);
    }
  }

  async function extract() {
    try {
      const value = await onExtract!(extractPath.trim(), varName.trim());
      setExtractStatus(
        `Saved {{var.${varName.trim()}}} = ${value.length > 60 ? value.slice(0, 60) + '…' : value}`,
      );
    } catch (e) {
      setExtractStatus((e as Error).message);
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
          ) : parsed ? (
            <JsonTree data={parsed.value} onPickPath={onExtract ? pickPath : undefined} />
          ) : (
            <pre className="transcript">{response.bodyText}</pre>
          )}
          {response.truncated && (
            <div className="banner warn small">Response truncated at 2 MB</div>
          )}
          {onExtract && parsed && (
            <div className="extract-form">
              <span className="extract-label">extract</span>
              <input
                placeholder="click a key above, or type a path"
                value={extractPath}
                onChange={(e) => setExtractPath(e.target.value)}
              />
              <span className="extract-label">into</span>
              <input
                placeholder="variable name"
                value={varName}
                onChange={(e) => setVarName(e.target.value)}
              />
              <button onClick={extract} disabled={!extractPath.trim() || !varName.trim()}>
                →
              </button>
              {extractStatus && <div className="hint extract-status">{extractStatus}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
