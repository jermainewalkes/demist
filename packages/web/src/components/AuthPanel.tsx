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
  const [mode, setMode] = useState<'token' | 'client_credentials'>(current?.mode ?? 'token');
  const [clientId, setClientId] = useState(current?.clientId ?? '');
  const [scopes, setScopes] = useState((current?.scopes ?? []).join(' '));
  const [server, setServer] = useState(loadedApi.entry.server ?? loadedApi.index.servers[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scheme = schemes[schemeKey];
  const isBasic = scheme?.type === 'http' && scheme.scheme === 'basic';
  const isOauth = scheme?.type === 'oauth2' || scheme?.type === 'openIdConnect';
  const ccTokenUrl =
    scheme?.flows?.clientCredentials?.tokenUrl ??
    Object.values(scheme?.flows ?? {}).find((f) => f.tokenUrl)?.tokenUrl;
  const useClientCredentials = isOauth && mode === 'client_credentials';

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
          ? {
              scheme: schemeKey,
              secret: secretName,
              username: isBasic ? username : undefined,
              mode: isOauth ? mode : undefined,
              clientId: useClientCredentials ? clientId : undefined,
              scopes: useClientCredentials
                ? scopes.split(/\s+/).filter((s) => s !== '')
                : undefined,
            }
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
          {isOauth && (
            <>
              <label>
                OAuth2 mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'token' | 'client_credentials')}
                >
                  <option value="token">paste an access token</option>
                  <option value="client_credentials" disabled={!ccTokenUrl}>
                    client credentials{ccTokenUrl ? '' : ' (spec declares no tokenUrl)'}
                  </option>
                </select>
              </label>
              {useClientCredentials && (
                <>
                  <p className="hint">
                    demist will fetch tokens from <code>{ccTokenUrl}</code> and cache them until
                    expiry.
                  </p>
                  <label>
                    Client ID
                    <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </label>
                  <label>
                    Scopes (space-separated, optional)
                    <input value={scopes} onChange={(e) => setScopes(e.target.value)} />
                  </label>
                </>
              )}
              {!useClientCredentials && (
                <p className="hint">
                  The pasted token is stored in the vault and sent as a Bearer header.
                </p>
              )}
            </>
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
            Secret value {isBasic ? '(password)' : useClientCredentials ? '(client secret)' : '(key / token)'}
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
