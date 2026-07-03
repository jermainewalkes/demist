import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LoadedApi } from '../App';

type OauthMode = 'token' | 'client_credentials' | 'authorization_code';

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
  const [mode, setMode] = useState<OauthMode>(current?.mode ?? 'token');
  const [oauthStatus, setOauthStatus] = useState<{ authorized: boolean; expiresAt?: number } | null>(null);
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
  const acFlow =
    scheme?.flows?.authorizationCode ??
    Object.values(scheme?.flows ?? {}).find((f) => f.authorizationUrl && f.tokenUrl);
  const useClientCredentials = isOauth && mode === 'client_credentials';
  const useAuthCode = isOauth && mode === 'authorization_code';
  const callbackUrl = `${window.location.protocol}//127.0.0.1:4400/api/oauth/callback`;

  useEffect(() => {
    if (!useAuthCode) return;
    let timer: ReturnType<typeof setInterval>;
    const poll = () => api.oauthStatus(apiId).then(setOauthStatus).catch(() => {});
    void poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [useAuthCode, apiId]);

  async function saveAndAuthorize() {
    await save();
    window.open(api.oauthStartUrl(apiId), '_blank');
  }

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
              clientId: useClientCredentials || useAuthCode ? clientId : undefined,
              scopes:
                useClientCredentials || useAuthCode
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
                <select value={mode} onChange={(e) => setMode(e.target.value as OauthMode)}>
                  <option value="token">paste an access token</option>
                  <option value="client_credentials" disabled={!ccTokenUrl}>
                    client credentials{ccTokenUrl ? '' : ' (spec declares no tokenUrl)'}
                  </option>
                  <option value="authorization_code" disabled={!acFlow}>
                    authorization code — log in via browser
                    {acFlow ? '' : ' (spec declares no such flow)'}
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
              {useAuthCode && (
                <>
                  <p className="hint">
                    Register this redirect URI with the provider: <code>{callbackUrl}</code>.
                    demist uses PKCE; tokens are stored encrypted in the vault and refreshed
                    automatically.
                  </p>
                  <label>
                    Client ID
                    <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </label>
                  <label>
                    Scopes (space-separated, optional)
                    <input value={scopes} onChange={(e) => setScopes(e.target.value)} />
                  </label>
                  <div className="auth-actions">
                    <button onClick={saveAndAuthorize} disabled={saving || !clientId}>
                      Save &amp; authorize in browser
                    </button>
                    {oauthStatus &&
                      (oauthStatus.authorized ? (
                        <span className="auth-ok">
                          authorized
                          {oauthStatus.expiresAt
                            ? ` · token ${oauthStatus.expiresAt > Date.now() ? 'valid' : 'expired (will refresh)'}`
                            : ''}
                        </span>
                      ) : (
                        <span className="auth-missing">not authorized yet</span>
                      ))}
                  </div>
                </>
              )}
              {mode === 'token' && (
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
            Secret value{' '}
            {isBasic
              ? '(password)'
              : useClientCredentials
                ? '(client secret)'
                : useAuthCode
                  ? '(client secret — leave empty for PKCE-only public clients)'
                  : '(key / token)'}
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
