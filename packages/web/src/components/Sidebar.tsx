import { useState } from 'react';
import { api } from '../api';
import type { LoadedApi } from '../App';
import type { OperationSummary, WorkspaceApi } from '../types';

interface Props {
  apis: WorkspaceApi[];
  loaded: Record<string, LoadedApi>;
  selected: { apiId: string; opId: string } | null;
  onLoadApi: (id: string) => Promise<LoadedApi>;
  onSelect: (apiId: string, opId: string) => void;
  onWorkspaceChanged: () => void;
}

export function Sidebar({ apis, loaded, selected, onLoadApi, onSelect, onWorkspaceChanged }: Props) {
  const [specUrl, setSpecUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [openApis, setOpenApis] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  async function addApi() {
    if (!specUrl.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const { id } = await api.addApi({ url: specUrl.trim() });
      setSpecUrl('');
      onWorkspaceChanged();
      await onLoadApi(id);
      setOpenApis((prev) => new Set(prev).add(id));
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function toggleApi(id: string) {
    const next = new Set(openApis);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!loaded[id]) {
        try {
          await onLoadApi(id);
        } catch (e) {
          setAddError((e as Error).message);
          next.delete(id);
        }
      }
    }
    setOpenApis(next);
  }

  async function removeApi(id: string) {
    if (!confirm(`Remove "${id}" from the workspace?`)) return;
    await api.removeApi(id);
    onWorkspaceChanged();
  }

  return (
    <aside className="sidebar">
      <div className="add-api">
        <input
          value={specUrl}
          onChange={(e) => setSpecUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addApi()}
          placeholder="Paste an OpenAPI spec URL…"
          disabled={adding}
        />
        <button onClick={addApi} disabled={adding || !specUrl.trim()}>
          {adding ? 'Reading spec…' : 'Add API'}
        </button>
        {addError && <div className="banner error small">{addError}</div>}
      </div>

      {apis.length > 0 && (
        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter operations…"
        />
      )}

      {apis.map((entry) => {
        const isOpen = openApis.has(entry.id);
        const loadedApi = loaded[entry.id];
        return (
          <div key={entry.id} className="api-block">
            <div className="api-header" onClick={() => toggleApi(entry.id)}>
              <span className="disclosure">{isOpen ? '▾' : '▸'}</span>
              <span className="api-name" title={entry.spec.url}>{entry.name}</span>
              {loadedApi && <span className="op-count">{loadedApi.index.operations.length}</span>}
              <button
                className="remove"
                title="Remove API"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeApi(entry.id);
                }}
              >
                ×
              </button>
            </div>
            {isOpen && loadedApi && (
              <ApiOperations
                apiId={entry.id}
                operations={loadedApi.index.operations}
                warnings={loadedApi.index.warnings}
                search={search}
                selected={selected}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </aside>
  );
}

function ApiOperations({
  apiId,
  operations,
  warnings,
  search,
  selected,
  onSelect,
}: {
  apiId: string;
  operations: OperationSummary[];
  warnings: string[];
  search: string;
  selected: { apiId: string; opId: string } | null;
  onSelect: (apiId: string, opId: string) => void;
}) {
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const matches = (op: OperationSummary) =>
    q === '' ||
    op.path.toLowerCase().includes(q) ||
    op.id.toLowerCase().includes(q) ||
    (op.summary ?? '').toLowerCase().includes(q);

  const byTag = new Map<string, OperationSummary[]>();
  for (const op of operations) {
    if (!matches(op)) continue;
    const tag = op.tags[0] ?? '(untagged)';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }

  return (
    <div className="operations">
      {warnings.length > 0 && (
        <details className="spec-warnings">
          <summary>{warnings.length} spec warning{warnings.length > 1 ? 's' : ''}</summary>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {[...byTag.entries()].map(([tag, ops]) => {
        // Searching auto-expands; otherwise tags are collapsed until clicked
        const isOpen = q !== '' || openTags.has(tag);
        return (
          <div key={tag}>
            <div
              className="tag-header"
              onClick={() =>
                setOpenTags((prev) => {
                  const next = new Set(prev);
                  if (next.has(tag)) next.delete(tag);
                  else next.add(tag);
                  return next;
                })
              }
            >
              <span className="disclosure">{isOpen ? '▾' : '▸'}</span> {tag}
              <span className="op-count">{ops.length}</span>
            </div>
            {isOpen &&
              ops.map((op) => (
                <div
                  key={op.id}
                  className={
                    'op-row' +
                    (selected?.apiId === apiId && selected.opId === op.id ? ' active' : '') +
                    (op.deprecated ? ' deprecated' : '')
                  }
                  onClick={() => onSelect(apiId, op.id)}
                  title={op.summary ?? op.id}
                >
                  <span className={`method ${op.method.toLowerCase()}`}>{op.method}</span>
                  <span className="path">{op.path}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
