import type {
  ApiIndex,
  AuthProfile,
  ExecutePayload,
  ExecuteResult,
  OperationDetail,
  SavedRequest,
  SpecDiff,
  WorkspaceApi,
} from './types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  workspace: () =>
    call<{
      apis: WorkspaceApi[];
      variables: Record<string, string>;
      requests: SavedRequest[];
      vaultEnabled: boolean;
    }>('/api/workspace'),

  putVariable: (name: string, value: string) =>
    call(`/api/variables/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  deleteVariable: (name: string) =>
    call(`/api/variables/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  saveRequest: (body: Omit<SavedRequest, 'id'>) =>
    call<SavedRequest>('/api/requests', { method: 'POST', body: JSON.stringify(body) }),

  deleteRequest: (id: string) =>
    call(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  addApi: (body: { url?: string; text?: string; name?: string }) =>
    call<{ id: string; index: ApiIndex }>('/api/apis', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeApi: (id: string) => call(`/api/apis/${id}`, { method: 'DELETE' }),

  getApi: (id: string) =>
    call<{ entry: WorkspaceApi; index: ApiIndex }>(`/api/apis/${id}`),

  getOperation: (apiId: string, opId: string) =>
    call<OperationDetail>(`/api/apis/${apiId}/operations/${encodeURIComponent(opId)}`),

  putConfig: (apiId: string, body: { server?: string; auth?: AuthProfile | null }) =>
    call(`/api/apis/${apiId}/config`, { method: 'PUT', body: JSON.stringify(body) }),

  secrets: () => call<{ enabled: boolean; names: string[] }>('/api/secrets'),

  putSecret: (name: string, value: string) =>
    call(`/api/secrets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  execute: (payload: ExecutePayload) =>
    call<ExecuteResult>('/api/execute', { method: 'POST', body: JSON.stringify(payload) }),

  oauthStatus: (apiId: string) =>
    call<{ authorized: boolean; expiresAt?: number; hasRefresh?: boolean }>(
      `/api/oauth/status?apiId=${encodeURIComponent(apiId)}`,
    ),

  oauthStartUrl: (apiId: string) => `/api/oauth/start?apiId=${encodeURIComponent(apiId)}`,

  forgetOauthTokens: (apiId: string) =>
    call(`/api/oauth/tokens/${encodeURIComponent(apiId)}`, { method: 'DELETE' }),

  diffApi: (id: string) => call<SpecDiff>(`/api/apis/${id}/diff`),

  refreshApi: (id: string) =>
    call<{ index: ApiIndex }>(`/api/apis/${id}/refresh`, { method: 'POST' }),
};
