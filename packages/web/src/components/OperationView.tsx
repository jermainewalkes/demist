import { useEffect, useMemo, useRef, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import { api } from '../api';
import type { LoadedApi } from '../App';
import { AuthPanel } from './AuthPanel';
import { HttpPane } from './HttpPane';
import { getPath } from '../util';
import type {
  ExecuteResult,
  OperationDetail,
  OperationSummary,
  ParameterDetail,
  SavedRequest,
} from '../types';

interface Props {
  apiId: string;
  loadedApi: LoadedApi;
  summary: OperationSummary;
  initial?: SavedRequest;
  vaultEnabled: boolean;
  onConfigChanged: () => void;
  onWorkspaceChanged: () => void;
}

const NO_SUBMIT: UiSchema = { 'ui:submitButtonOptions': { norender: true } };

function groupSchema(params: ParameterDetail[]): RJSFSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      params.map((p) => [p.name, { description: p.description, ...p.schema }]),
    ),
    required: params.filter((p) => p.required).map((p) => p.name),
  } as RJSFSchema;
}

/**
 * Numeric parameters render as text fields, not number spinners: params are
 * strings on the wire anyway, and a number input would reject {{var.x}}.
 */
function groupUiSchema(params: ParameterDetail[]): UiSchema {
  const ui: UiSchema = { ...NO_SUBMIT };
  for (const p of params) {
    const t = p.schema.type;
    const numeric = Array.isArray(t)
      ? t.some((x) => x === 'integer' || x === 'number')
      : t === 'integer' || t === 'number';
    if (numeric) ui[p.name] = { 'ui:widget': 'text' };
  }
  return ui;
}

export function OperationView({
  apiId,
  loadedApi,
  summary,
  initial,
  vaultEnabled,
  onConfigChanged,
  onWorkspaceChanged,
}: Props) {
  const [detail, setDetail] = useState<OperationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paramData, setParamData] = useState<Record<string, Record<string, unknown>>>(
    (initial?.params as Record<string, Record<string, unknown>>) ?? {},
  );
  const [contentType, setContentType] = useState<string | undefined>();
  const [bodyData, setBodyData] = useState<unknown>(
    typeof initial?.body === 'string' ? undefined : initial?.body,
  );
  const [rawBody, setRawBody] = useState(typeof initial?.body === 'string' ? initial.body : '');
  const [bodyMode, setBodyMode] = useState<'form' | 'raw'>('form');
  const [preview, setPreview] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [missingRefs, setMissingRefs] = useState<string[]>([]);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [sending, setSending] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api
      .getOperation(apiId, summary.id)
      .then((d) => {
        setDetail(d);
        setContentType(initial?.contentType ?? d.body?.variants[0]?.contentType);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [apiId, summary.id]);

  const variant = detail?.body?.variants.find((v) => v.contentType === contentType);
  const bodyIsFormable = useMemo(() => {
    const t = variant?.schema.type;
    return t === 'object' || (variant?.schema.properties !== undefined);
  }, [variant]);

  function effectiveBody(): unknown {
    if (!detail?.body) return undefined;
    if (bodyMode === 'raw' || !bodyIsFormable) {
      if (rawBody.trim() === '') return undefined;
      try {
        return contentType?.includes('json') ? JSON.parse(rawBody) : rawBody;
      } catch {
        return rawBody;
      }
    }
    return bodyData;
  }

  // Live dry-run preview: the form always shows the exact HTTP it will produce.
  useEffect(() => {
    if (!detail) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.execute({
          apiId,
          opId: summary.id,
          params: paramData,
          contentType,
          body: effectiveBody(),
          dryRun: true,
        });
        setPreview(r.request.raw);
        setPreviewError(null);
        setMissingRefs(r.missing ?? []);
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, paramData, bodyData, rawBody, bodyMode, contentType, loadedApi.entry]);

  async function saveRequest() {
    const name = window.prompt('Name this request:', `${detail?.method} ${detail?.path}`);
    if (!name) return;
    try {
      await api.saveRequest({
        name,
        apiId,
        opId: summary.id,
        params: paramData,
        contentType,
        body: effectiveBody(),
      });
      onWorkspaceChanged();
    } catch (e) {
      setPreviewError((e as Error).message);
    }
  }

  async function extractToVariable(path: string, varName: string): Promise<string> {
    const bodyText = result?.response?.bodyText;
    if (!bodyText) throw new Error('No response body to extract from');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error('Response body is not JSON');
    }
    const value = getPath(parsed, path);
    if (value === undefined) throw new Error(`Nothing found at "${path}"`);
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    await api.putVariable(varName, str);
    onWorkspaceChanged();
    return str;
  }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const r = await api.execute({
        apiId,
        opId: summary.id,
        params: paramData,
        contentType,
        body: effectiveBody(),
      });
      setResult(r);
    } catch (e) {
      setResult({ request: { method: summary.method, url: '', raw: preview }, error: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <div className="banner error">{loadError}</div>;
  if (!detail) return <div className="empty">Loading operation…</div>;

  const groups: { label: string; params: ParameterDetail[] }[] = (
    ['path', 'query', 'header'] as const
  )
    .map((loc) => ({
      label: { path: 'Path parameters', query: 'Query parameters', header: 'Headers' }[loc],
      params: detail.parameters.filter((p) => p.in === loc),
    }))
    .filter((g) => g.params.length > 0);

  const needsAuth = detail.security.length > 0;
  const hasAuth = Boolean(loadedApi.entry.auth);

  return (
    <div className="operation-view">
      <div className="op-pane">
        <div className="op-title">
          <span className={`method big ${detail.method.toLowerCase()}`}>{detail.method}</span>
          <code className="op-path">{detail.path}</code>
        </div>
        {detail.summary && <p className="op-summary">{detail.summary}</p>}
        {detail.deprecated && <div className="banner warn">This operation is deprecated.</div>}

        <div className="auth-line">
          {needsAuth ? (
            <span className={hasAuth ? 'auth-ok' : 'auth-missing'}>
              {hasAuth
                ? `auth: ${loadedApi.entry.auth!.scheme}`
                : 'this operation declares auth — none configured'}
            </span>
          ) : (
            <span className="auth-none">no auth required</span>
          )}
          <button className="link" onClick={() => setShowAuth((s) => !s)}>
            {showAuth ? 'close auth settings' : 'auth & server settings'}
          </button>
        </div>
        {showAuth && (
          <AuthPanel
            apiId={apiId}
            loadedApi={loadedApi}
            vaultEnabled={vaultEnabled}
            onSaved={() => {
              setShowAuth(false);
              onConfigChanged();
            }}
          />
        )}

        {groups.map((g) => (
          <section key={g.label} className="form-section">
            <h3>{g.label}</h3>
            <Form
              schema={groupSchema(g.params)}
              validator={validator}
              uiSchema={groupUiSchema(g.params)}
              formData={paramData[g.params[0].in]}
              liveValidate={false}
              showErrorList={false}
              onChange={(e) =>
                setParamData((prev) => ({ ...prev, [g.params[0].in]: e.formData ?? {} }))
              }
            />
          </section>
        ))}

        {detail.body && (
          <section className="form-section">
            <h3>
              Request body{' '}
              {detail.body.variants.length > 1 && (
                <select value={contentType} onChange={(e) => setContentType(e.target.value)}>
                  {detail.body.variants.map((v) => (
                    <option key={v.contentType}>{v.contentType}</option>
                  ))}
                </select>
              )}
              {bodyIsFormable && (
                <button
                  className="link"
                  onClick={() => setBodyMode((m) => (m === 'form' ? 'raw' : 'form'))}
                >
                  {bodyMode === 'form' ? 'edit raw' : 'use form'}
                </button>
              )}
            </h3>
            {bodyIsFormable && bodyMode === 'form' ? (
              <Form
                schema={(variant?.schema ?? {}) as RJSFSchema}
                validator={validator}
                uiSchema={NO_SUBMIT}
                formData={bodyData}
                liveValidate={false}
                showErrorList={false}
                onChange={(e) => setBodyData(e.formData)}
              />
            ) : (
              <textarea
                className="raw-body"
                value={rawBody}
                onChange={(e) => setRawBody(e.target.value)}
                placeholder={contentType?.includes('json') ? '{ … JSON body … }' : 'request body'}
                rows={8}
              />
            )}
          </section>
        )}

        {missingRefs.length > 0 && (
          <div className="banner warn small">
            Unresolved: {missingRefs.map((m) => `{{${m}}}`).join(', ')} — define the variable or
            secret before sending.
          </div>
        )}

        <div className="send-row">
          <button className="send" onClick={send} disabled={sending}>
            {sending ? 'Sending…' : `Send ${detail.method}`}
          </button>
          <button onClick={saveRequest}>Save request…</button>
          {detail.responses.length > 0 && (
            <span className="expected">
              expects: {detail.responses.map((r) => r.status).join(', ')}
            </span>
          )}
        </div>
      </div>

      <HttpPane
        preview={preview}
        previewError={previewError}
        result={result}
        onExtract={result?.response ? extractToVariable : undefined}
      />
    </div>
  );
}
