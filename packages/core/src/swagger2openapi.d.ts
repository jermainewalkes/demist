declare module 'swagger2openapi' {
  interface ConvertOptions {
    patch?: boolean;
    warnOnly?: boolean;
    anchors?: boolean;
  }
  interface ConvertResult {
    openapi: Record<string, unknown>;
    warnings?: unknown[];
  }
  export function convertObj(spec: unknown, options: ConvertOptions): Promise<ConvertResult>;
}
