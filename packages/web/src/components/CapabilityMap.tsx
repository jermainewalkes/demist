import { useMemo, useState } from 'react';
import type { LoadedApi } from '../App';
import type { OperationSummary } from '../types';

interface Props {
  loadedApi: LoadedApi;
  onSelectOp: (opId: string) => void;
}

interface PathNode {
  segment: string;
  fullPath: string;
  children: Map<string, PathNode>;
  ops: OperationSummary[];
  /** total operations in this subtree */
  count: number;
}

function buildTree(operations: OperationSummary[]): PathNode {
  const root: PathNode = { segment: '', fullPath: '', children: new Map(), ops: [], count: 0 };
  for (const op of operations) {
    const segments = op.path.split('/').filter((s) => s !== '');
    let node = root;
    node.count++;
    let full = '';
    for (const seg of segments) {
      full += `/${seg}`;
      if (!node.children.has(seg)) {
        node.children.set(seg, { segment: seg, fullPath: full, children: new Map(), ops: [], count: 0 });
      }
      node = node.children.get(seg)!;
      node.count++;
    }
    node.ops.push(op);
  }
  return root;
}

/**
 * The X-ray view: everything this API can do, derived purely from its spec —
 * a stats strip and the resource tree with per-verb actions.
 */
export function CapabilityMap({ loadedApi, onSelectOp }: Props) {
  const { index } = loadedApi;
  const tree = useMemo(() => buildTree(index.operations), [index.operations]);

  const methodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const op of index.operations) {
      counts.set(op.method, (counts.get(op.method) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [index.operations]);

  const deprecatedCount = index.operations.filter((o) => o.deprecated).length;

  return (
    <div className="capability-map">
      <h2>{index.info.title}</h2>
      {index.info.description && <p className="op-summary">{index.info.description.slice(0, 400)}</p>}

      <div className="stats-row">
        <div className="stat">
          <span className="stat-num">{index.operations.length}</span>
          <span className="stat-label">operations</span>
        </div>
        <div className="stat">
          <span className="stat-num">{index.schemaCount}</span>
          <span className="stat-label">schemas</span>
        </div>
        <div className="stat">
          <span className="stat-num">{Object.keys(index.securitySchemes).length}</span>
          <span className="stat-label">auth schemes</span>
        </div>
        {deprecatedCount > 0 && (
          <div className="stat">
            <span className="stat-num">{deprecatedCount}</span>
            <span className="stat-label">deprecated</span>
          </div>
        )}
      </div>

      <div className="method-bar">
        {methodCounts.map(([method, count]) => (
          <span key={method} className={`method ${method.toLowerCase()}`}>
            {method} × {count}
          </span>
        ))}
      </div>

      {Object.keys(index.securitySchemes).length > 0 && (
        <p className="hint">
          Auth:{' '}
          {Object.entries(index.securitySchemes)
            .map(([k, s]) => `${k} (${s.type}${s.scheme ? `/${s.scheme}` : ''})`)
            .join(' · ')}
        </p>
      )}
      {index.servers.length > 0 && <p className="hint">Servers: {index.servers.join(' · ')}</p>}

      <h3 className="tree-title">Resources</h3>
      <div className="path-tree">
        {[...tree.children.values()].map((node) => (
          <TreeNode key={node.fullPath} node={node} depth={0} onSelectOp={onSelectOp} />
        ))}
        {tree.ops.map((op) => (
          <OpLeaf key={op.id} op={op} depth={0} onSelectOp={onSelectOp} />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  onSelectOp,
}: {
  node: PathNode;
  depth: number;
  onSelectOp: (opId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isParam = node.segment.startsWith('{');
  return (
    <div className="tree-node" style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <div className="tree-row" onClick={() => setOpen((o) => !o)}>
        <span className="disclosure">{open ? '▾' : '▸'}</span>
        <code className={isParam ? 'seg param' : 'seg'}>/{node.segment}</code>
        <span className="op-count">{node.count}</span>
      </div>
      {open && (
        <>
          {node.ops.map((op) => (
            <OpLeaf key={op.id} op={op} depth={depth + 1} onSelectOp={onSelectOp} />
          ))}
          {[...node.children.values()].map((child) => (
            <TreeNode key={child.fullPath} node={child} depth={depth + 1} onSelectOp={onSelectOp} />
          ))}
        </>
      )}
    </div>
  );
}

function OpLeaf({
  op,
  depth,
  onSelectOp,
}: {
  op: OperationSummary;
  depth: number;
  onSelectOp: (opId: string) => void;
}) {
  return (
    <div
      className={`tree-row leaf${op.deprecated ? ' deprecated' : ''}`}
      style={{ marginLeft: depth === 0 ? 0 : 16 }}
      onClick={() => onSelectOp(op.id)}
      title={op.path}
    >
      <span className={`method ${op.method.toLowerCase()}`}>{op.method}</span>
      <span className="leaf-summary">{op.summary ?? op.id}</span>
    </div>
  );
}
