import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { initFieldTracking } from './fieldInsert';
import { Sidebar } from './components/Sidebar';
import { OperationView } from './components/OperationView';
import { CapabilityMap } from './components/CapabilityMap';
import { SpecDiffView } from './components/SpecDiffView';
import type { ApiIndex, SavedRequest, WorkspaceApi } from './types';

export interface LoadedApi {
  entry: WorkspaceApi;
  index: ApiIndex;
}

type View =
  | { kind: 'op'; apiId: string; opId: string }
  | { kind: 'map'; apiId: string }
  | { kind: 'diff'; apiId: string }
  | null;

export function App() {
  const [apis, setApis] = useState<WorkspaceApi[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<SavedRequest[]>([]);
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LoadedApi>>({});
  const [view, setView] = useState<View>(null);
  const [restore, setRestore] = useState<SavedRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoreCounter = useRef(0);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await api.workspace();
      setApis(ws.apis);
      setVariables(ws.variables);
      setRequests(ws.requests);
      setVaultEnabled(ws.vaultEnabled);
    } catch (e) {
      setError(`Cannot reach the demist server — is it running? (${(e as Error).message})`);
    }
  }, []);

  useEffect(() => {
    initFieldTracking();
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const loadApi = useCallback(async (id: string) => {
    const result = await api.getApi(id);
    setLoaded((prev) => ({ ...prev, [id]: result }));
    return result;
  }, []);

  const ensureLoaded = useCallback(
    async (id: string): Promise<boolean> => {
      if (loaded[id]) return true;
      try {
        await loadApi(id);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    [loaded, loadApi],
  );

  const selectOperation = useCallback((apiId: string, opId: string) => {
    setRestore(null);
    setView({ kind: 'op', apiId, opId });
    // Deep-linkable: #apiId/opId
    window.history.replaceState(null, '', `#${encodeURIComponent(apiId)}/${encodeURIComponent(opId)}`);
  }, []);

  // Restore an operation from the URL hash on load (shareable links, screenshots).
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    const i = raw.indexOf('/');
    if (i <= 0) return;
    const apiId = decodeURIComponent(raw.slice(0, i));
    const opId = decodeURIComponent(raw.slice(i + 1));
    loadApi(apiId)
      .then(() => setView({ kind: 'op', apiId, opId }))
      .catch(() => {});
  }, [loadApi]);

  const selectSavedRequest = useCallback(
    async (saved: SavedRequest) => {
      if (!(await ensureLoaded(saved.apiId))) return;
      restoreCounter.current++;
      setRestore(saved);
      setView({ kind: 'op', apiId: saved.apiId, opId: saved.opId });
    },
    [ensureLoaded],
  );

  const showMap = useCallback(
    async (apiId: string) => {
      if (await ensureLoaded(apiId)) setView({ kind: 'map', apiId });
    },
    [ensureLoaded],
  );

  const showDiff = useCallback(
    async (apiId: string) => {
      if (await ensureLoaded(apiId)) setView({ kind: 'diff', apiId });
    },
    [ensureLoaded],
  );

  const viewApi = view ? loaded[view.apiId] : undefined;
  const viewOp =
    view?.kind === 'op' ? viewApi?.index.operations.find((o) => o.id === view.opId) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">demist</span>
        <span className="tagline">the API workbench that shows its work</span>
        <span className={`vault-dot ${vaultEnabled ? 'on' : 'off'}`}>
          vault {vaultEnabled ? 'unlocked' : 'disabled'}
        </span>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="columns">
        <Sidebar
          apis={apis}
          variables={variables}
          requests={requests}
          loaded={loaded}
          selected={view?.kind === 'op' ? { apiId: view.apiId, opId: view.opId } : null}
          onLoadApi={loadApi}
          onSelect={selectOperation}
          onSelectSaved={selectSavedRequest}
          onShowMap={showMap}
          onShowDiff={showDiff}
          onWorkspaceChanged={refreshWorkspace}
        />
        <main className="main">
          {view?.kind === 'op' && viewApi && viewOp ? (
            <OperationView
              key={`${view.apiId}:${view.opId}:${restore ? `${restore.id}#${restoreCounter.current}` : ''}`}
              apiId={view.apiId}
              loadedApi={viewApi}
              summary={viewOp}
              initial={restore ?? undefined}
              vaultEnabled={vaultEnabled}
              onConfigChanged={() => loadApi(view.apiId)}
              onWorkspaceChanged={refreshWorkspace}
            />
          ) : view?.kind === 'map' && viewApi ? (
            <CapabilityMap
              loadedApi={viewApi}
              onSelectOp={(opId) => selectOperation(view.apiId, opId)}
            />
          ) : view?.kind === 'diff' && viewApi ? (
            <SpecDiffView
              apiId={view.apiId}
              apiName={viewApi.entry.name}
              onRefreshed={async () => {
                await loadApi(view.apiId);
                setView({ kind: 'map', apiId: view.apiId });
              }}
            />
          ) : (
            <div className="empty">
              <h2>No operation selected</h2>
              <p>
                Add an API by pasting an OpenAPI/Swagger spec URL on the left, then pick an
                operation. demist generates the form from the spec — and always shows you the
                exact HTTP it sends.
              </p>
              <p>
                Tip: any field can reference workspace variables as <code>{'{{var.name}}'}</code>{' '}
                or vault secrets as <code>{'{{secret.name}}'}</code>.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
