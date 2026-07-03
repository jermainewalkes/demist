import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { OperationView } from './components/OperationView';
import type { ApiIndex, SavedRequest, WorkspaceApi } from './types';

export interface LoadedApi {
  entry: WorkspaceApi;
  index: ApiIndex;
}

export function App() {
  const [apis, setApis] = useState<WorkspaceApi[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<SavedRequest[]>([]);
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LoadedApi>>({});
  const [selected, setSelected] = useState<{ apiId: string; opId: string } | null>(null);
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
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const loadApi = useCallback(async (id: string) => {
    const result = await api.getApi(id);
    setLoaded((prev) => ({ ...prev, [id]: result }));
    return result;
  }, []);

  const selectOperation = useCallback((apiId: string, opId: string) => {
    setRestore(null);
    setSelected({ apiId, opId });
  }, []);

  const selectSavedRequest = useCallback(
    async (saved: SavedRequest) => {
      if (!loaded[saved.apiId]) {
        try {
          await loadApi(saved.apiId);
        } catch (e) {
          setError((e as Error).message);
          return;
        }
      }
      restoreCounter.current++;
      setRestore(saved);
      setSelected({ apiId: saved.apiId, opId: saved.opId });
    },
    [loaded, loadApi],
  );

  const selectedApi = selected ? loaded[selected.apiId] : undefined;
  const selectedOp = selectedApi?.index.operations.find((o) => o.id === selected?.opId);

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
          selected={selected}
          onLoadApi={loadApi}
          onSelect={selectOperation}
          onSelectSaved={selectSavedRequest}
          onWorkspaceChanged={refreshWorkspace}
        />
        <main className="main">
          {selectedApi && selectedOp ? (
            <OperationView
              key={`${selected!.apiId}:${selected!.opId}:${restore ? `${restore.id}#${restoreCounter.current}` : ''}`}
              apiId={selected!.apiId}
              loadedApi={selectedApi}
              summary={selectedOp}
              initial={restore ?? undefined}
              vaultEnabled={vaultEnabled}
              onConfigChanged={() => loadApi(selected!.apiId)}
              onWorkspaceChanged={refreshWorkspace}
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
