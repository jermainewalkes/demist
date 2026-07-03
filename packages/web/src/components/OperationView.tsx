import { useEffect, useMemo, useRef, useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import { api } from '../api';
import type { LoadedApi } from '../App';
import { AuthPanel } from './AuthPanel';
import { HttpPane } from './HttpPane';
import type {
  ExecuteResult,
  OperationDetail,
  OperationSummary,
  ParameterDetail,
} from '../types';

interface Props {
  apiId: string;
  loadedApi: LoadedApi;
  summary: OperationSummary;
  vaultEnabled: boolean;
  onConfigChanged: () => void;
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

export function OperationView({ apiId, loadedApi, summary, vaultEnabled, onConfigChanged }: Props) {
  const [detail, setDetail] = useState<OperationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paramData, setParamData] = useState<Record<string, Record<string, unknown>>>({});
  const [contentType, setContentType] = useState<string | undefined>();
  const [bodyData, setBodyData] = useState<unknown>(undefined);
  const [rawBody, setRawBody] = useState('');
  const [bodyMode, setBodyMode] = useState<'form' | 'raw'>('form');
  const [preview, setPreview] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [sending, setSending] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api
      .getOperation(apiId, summary.id)
      .then((d) => {
        setDetail(d);
        setContentType(d.body?.variants[0]?.contentType);
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
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, paramData, bodyData, rawBody, bodyMode, contentType, loadedApi.entry]);

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
              uiSchema={NO_SUBMIT}
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

        <div className="send-row">
          <button className="send" onClick={send} disabled={sending}>
            {sending ? 'Sending…' : `Send ${detail.method}`}
          </button>
          {detail.responses.length > 0 && (
            <span className="expected">
              expects: {detail.responses.map((r) => r.status).join(', ')}
            </span>
          )}
        </div>
      </div>

      <HttpPane preview={preview} previewError={previewError} result={result} />
    </div>
  );
}
