import { useState } from 'react';
import { api } from '../api';
import type { LoadedApi } from '../App';

interface Props {
  apiId: string;
  loadedApi: LoadedApi;
  vaultEnabled: boolean;
  onSaved: () => void;
}

/**
 * Configure the base URL and one auth profile per API. The schemes offered are
 * exactly what the spec declares — demist derives, it doesn't invent.
 * Secret values go straight into the server-side vault; the UI never re-reads them.
 */
export function AuthPanel({ apiId, loadedApi, vaultEnabled, onSaved }: Props) {
  const schemes = loadedApi.index.securitySchemes;
  const schemeKeys = Object.keys(schemes);
  const current = loadedApi.entry.auth;

  const [schemeKey, setSchemeKey] = useState(current?.scheme ?? schemeKeys[0] ?? '');
  const [secretName, setSecretName] = useState(current?.secret ?? `${apiId}_secret`);
  const [secretValue, setSecretValue] = useState('');
  const [username, setUsername] = useState(current?.username ?? '');
  const [server, setServer] = useState(loadedApi.entry.server ?? loadedApi.index.servers[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scheme = schemes[schemeKey];
  const isBasic = scheme?.type === 'http' && scheme.scheme === 'basic';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (secretValue !== '') {
        await api.putSecret(secretName, secretValue);
      }
      await api.putConfig(apiId, {
        server: server || undefined,
        auth: schemeKey
          ? { scheme: schemeKey, secret: secretName, username: isBasic ? username : undefined }
          : null,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearAuth() {
    setSaving(true);
    try {
      await api.putConfig(apiId, { auth: null });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-panel">
      <label>
        Base URL
        <input value={server} onChange={(e) => setServer(e.target.value)} list={`servers-${apiId}`} />
        <datalist id={`servers-${apiId}`}>
          {loadedApi.index.servers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      {schemeKeys.length === 0 ? (
        <p className="hint">This spec declares no security schemes.</p>
      ) : (
        <>
          <label>
            Security scheme (from the spec)
            <select value={schemeKey} onChange={(e) => setSchemeKey(e.target.value)}>
              {schemeKeys.map((k) => (
                <option key={k} value={k}>
                  {k} — {schemes[k].type}
                  {schemes[k].type === 'apiKey' ? ` (${schemes[k].in}: ${schemes[k].name})` : ''}
                  {schemes[k].type === 'http' ? ` (${schemes[k].scheme})` : ''}
                </option>
              ))}
            </select>
          </label>
          {(scheme?.type === 'oauth2' || scheme?.type === 'openIdConnect') && (
            <p className="hint">
              OAuth2 flows aren't automated yet — paste an access token below and demist sends it
              as a Bearer header.
            </p>
          )}
          {isBasic && (
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
          )}
          <label>
            Vault entry name
            <input value={secretName} onChange={(e) => setSecretName(e.target.value)} />
          </label>
          <label>
            Secret value {isBasic ? '(password)' : '(key / token)'}
            <input
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={current?.secret === secretName ? '(unchanged)' : ''}
              disabled={!vaultEnabled}
            />
          </label>
          {!vaultEnabled && (
            <div className="banner warn small">
              Vault disabled — restart demist with <code>DEMIST_VAULT_KEY</code> set to store
              secrets.
            </div>
          )}
        </>
      )}

      {error && <div className="banner error small">{error}</div>}
      <div className="auth-actions">
        <button onClick={save} disabled={saving}>
          Save
        </button>
        {current && (
          <button className="link" onClick={clearAuth} disabled={saving}>
            remove auth
          </button>
        )}
      </div>
    </div>
  );
}
