/** Walk a parsed JSON value by a lite path: "items[0].id", "0.name", "data.token". */
export function getPath(root: unknown, path: string): unknown {
  const tokens = path.match(/[^.[\]]+/g) ?? [];
  let node: unknown = root;
  for (const token of tokens) {
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
