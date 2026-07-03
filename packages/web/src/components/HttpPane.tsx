import { useState } from 'react';
import type { ExecuteResult } from '../types';

interface Props {
  preview: string;
  previewError: string | null;
  result: ExecuteResult | null;
}

/**
 * The de-mystifying pane: the exact request demist will send (live preview),
 * and the full exchange once sent. Secrets arrive pre-masked from the server.
 */
export function HttpPane({ preview, previewError, result }: Props) {
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
        </section>
      )}
    </div>
  );
}
