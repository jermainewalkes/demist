/**
 * Lite JSON paths, e.g. `items[0].id`, `0.name`, `headers["content-type"]`.
 * Bracket-quoted segments cover keys containing dots, brackets, or spaces.
 */

function tokenize(path: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      i++;
    } else if (ch === '[') {
      const quote = path[i + 1];
      if (quote === '"' || quote === "'") {
        const end = path.indexOf(`${quote}]`, i + 2);
        if (end === -1) return tokens; // malformed: stop cleanly
        tokens.push(path.slice(i + 2, end));
        i = end + 2;
      } else {
        const end = path.indexOf(']', i);
        if (end === -1) return tokens;
        tokens.push(path.slice(i + 1, end));
        i = end + 1;
      }
    } else {
      let j = i;
      while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
      tokens.push(path.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

/** Walk a parsed JSON value by path. */
export function getPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const token of tokenize(path)) {
    if (Array.isArray(node)) {
      node = node[Number(token)];
    } else if (typeof node === 'object' && node !== null) {
      node = (node as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return node;
}

const PLAIN_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Append one segment to a path, bracket-quoting keys that need it.
 * (Keys containing a double quote aren't representable — the tokenizer
 * doesn't unescape — but such keys are vanishingly rare in real APIs.)
 */
export function appendPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (PLAIN_KEY.test(key)) return base === '' ? key : `${base}.${key}`;
  return `${base}["${key}"]`;
}
