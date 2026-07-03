import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { OperationView } from './components/OperationView';
import type { ApiIndex, WorkspaceApi } from './types';

export interface LoadedApi {
  entry: WorkspaceApi;
  index: ApiIndex;
}

export function App() {
  const [apis, setApis] = useState<WorkspaceApi[]>([]);
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LoadedApi>>({});
  const [selected, setSelected] = useState<{ apiId: string; opId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await api.workspace();
      setApis(ws.apis);
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
          loaded={loaded}
          selected={selected}
          onLoadApi={loadApi}
          onSelect={(apiId, opId) => setSelected({ apiId, opId })}
          onWorkspaceChanged={refreshWorkspace}
        />
        <main className="main">
          {selectedApi && selectedOp ? (
            <OperationView
              key={`${selected!.apiId}:${selected!.opId}`}
              apiId={selected!.apiId}
              loadedApi={selectedApi}
              summary={selectedOp}
              vaultEnabled={vaultEnabled}
              onConfigChanged={() => loadApi(selected!.apiId)}
            />
          ) : (
            <div className="empty">
              <h2>No operation selected</h2>
              <p>
                Add an API by pasting an OpenAPI/Swagger spec URL on the left, then pick an
                operation. demist generates the form from the spec — and always shows you the
                exact HTTP it sends.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
