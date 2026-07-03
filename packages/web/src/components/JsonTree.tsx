import { useState } from 'react';
import { appendPath } from '../util';

interface TreeProps {
  data: unknown;
  /** When present, keys and indices are clickable and yield their path. */
  onPickPath?: (path: string) => void;
}

const MAX_CHILDREN = 100;
const DEFAULT_OPEN_DEPTH = 2;

/**
 * Interactive JSON view: every key and array index is clickable, producing the
 * exact extract-path for that node. Click the data you can see, get the path.
 */
export function JsonTree({ data, onPickPath }: TreeProps) {
  return (
    <div className="json-tree transcript">
      <Node value={data} path="" depth={0} onPickPath={onPickPath} />
    </div>
  );
}

function Node({
  value,
  path,
  depth,
  label,
  onPickPath,
}: {
  value: unknown;
  path: string;
  depth: number;
  label?: string | number;
  onPickPath?: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < DEFAULT_OPEN_DEPTH);
  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === 'object' && value !== null;

  const key =
    label !== undefined ? (
      <span
        className={onPickPath ? 'json-key clickable' : 'json-key'}
        title={onPickPath ? `extract ${path}` : undefined}
        onClick={
          onPickPath
            ? (e) => {
                e.stopPropagation();
                onPickPath(path);
              }
            : undefined
        }
      >
        {typeof label === 'number' ? `[${label}]` : JSON.stringify(label)}
      </span>
    ) : null;

  if (!isArray && !isObject) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 }}>
        {key}
        {key && <span className="json-punct">: </span>}
        <span className={`json-val ${typeof value}`}>{JSON.stringify(value) ?? 'undefined'}</span>
      </div>
    );
  }

  const entries: [string | number, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(value as Record<string, unknown>);
  const shown = entries.slice(0, MAX_CHILDREN);

  return (
    <div>
      <div
        className="json-row toggle"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="disclosure">{open ? '▾' : '▸'}</span>
        {key}
        {key && <span className="json-punct">: </span>}
        <span className="json-punct">
          {isArray ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </div>
      {open && (
        <>
          {shown.map(([k, v]) => (
            <Node
              key={String(k)}
              value={v}
              label={k}
              path={appendPath(path, k)}
              depth={depth + 1}
              onPickPath={onPickPath}
            />
          ))}
          {entries.length > MAX_CHILDREN && (
            <div className="json-row json-punct" style={{ paddingLeft: (depth + 1) * 14 }}>
              … {entries.length - MAX_CHILDREN} more
            </div>
          )}
        </>
      )}
    </div>
  );
}
