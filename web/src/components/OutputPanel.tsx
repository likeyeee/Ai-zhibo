import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLATFORMS, type OutputPushStatus, type OutputSnapshot, type PlatformId, type StreamDestination } from '@lingbo/shared';
import { api } from '../api';
import { explainError, useI18n } from '../i18n';
import type { MessageKey } from '../i18n/zh-CN';

interface Draft {
  id: string | null;
  platform: PlatformId;
  label: string;
  serverUrl: string;
  streamKey: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  id: null,
  platform: 'douyin',
  label: '',
  serverUrl: '',
  streamKey: '',
  enabled: true,
};

export function OutputPanel({ liveId }: { liveId: string | null }) {
  const { t } = useI18n();
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [output, setOutput] = useState<OutputSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const [listed, snapshot] = await Promise.all([api.destinations(), api.output()]);
    setDestinations(listed.destinations);
    setOutput(snapshot);
  };

  useEffect(() => {
    let cancelled = false;
    load().catch((reason) => {
      if (!cancelled) setError(explainError(t, reason));
    });
    const timer = window.setInterval(() => {
      api.output().then((snapshot) => {
        if (!cancelled) setOutput(snapshot);
      }).catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [t]);

  const save = async () => {
    if (!draft.label.trim() || !draft.serverUrl.trim()) {
      setError(t('error.invalid_push_url'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        platform: draft.platform,
        label: draft.label.trim(),
        serverUrl: draft.serverUrl.trim(),
        enabled: draft.enabled,
        ...(draft.streamKey.trim() ? { streamKey: draft.streamKey.trim() } : draft.id ? {} : { streamKey: '' }),
      };
      if (draft.id) await api.updateDestination(draft.id, body);
      else await api.createDestination(body);
      setDraft(EMPTY);
      setMessage(t('output.saved'));
      await load();
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await api.deleteDestination(id);
      if (draft.id === id) setDraft(EMPTY);
      setMessage(t('output.deleted'));
      await load();
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
    }
  };

  const statusFor = (id: string): OutputPushStatus =>
    output?.destinations.find((item) => item.destinationId === id)?.status ?? 'idle';

  const detailFor = (id: string) => output?.destinations.find((item) => item.destinationId === id)?.detail ?? '';

  return (
    <section className="panel output-panel">
      <header className="monitor-head">
        <h2>{t('output.title')}</h2>
        {liveId ? (
          <Link className="btn ghost" to={`/program/${liveId}`} target="_blank" rel="noreferrer">
            {t('output.program')}
          </Link>
        ) : null}
      </header>
      <p className="help">{t('output.hint')}</p>
      {error ? <p className="error-banner">{error}</p> : null}
      {message ? <p className="status-line">{message}</p> : null}
      {destinations.length === 0 ? <p className="empty">{t('output.empty')}</p> : null}
      <ul className="destinations">
        {destinations.map((item) => {
          const status = statusFor(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="dest-main"
                onClick={() =>
                  setDraft({
                    id: item.id,
                    platform: item.platform,
                    label: item.label,
                    serverUrl: item.serverUrl,
                    streamKey: '',
                    enabled: item.enabled,
                  })
                }
              >
                <strong>{item.label}</strong>
                <span>{t(`platform.${item.platform}`)}</span>
                <small>{item.serverUrl}</small>
              </button>
              <span className={status === 'live' || status === 'simulated' ? 'pill live' : 'pill'}>{t(statusKey(status))}</span>
              {detailFor(item.id) ? <small className="dest-detail">{detailFor(item.id)}</small> : null}
              {item.hasStreamKey ? <small>{t('output.keyKept')} {item.streamKeyHint}</small> : null}
              <button type="button" className="btn ghost" onClick={() => void remove(item.id)} disabled={busy}>
                {t('output.delete')}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="output-form">
        <label className="field">
          <span>{t('output.platform')}</span>
          <select
            value={draft.platform}
            onChange={(event) => setDraft({ ...draft, platform: event.target.value as PlatformId })}
          >
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {t(`platform.${platform}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('output.label')}</span>
          <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
        </label>
        <label className="field">
          <span>{t('output.serverUrl')}</span>
          <input
            value={draft.serverUrl}
            placeholder="rtmp://127.0.0.1:1935/live"
            onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('output.streamKey')}</span>
          <input
            type="password"
            autoComplete="off"
            value={draft.streamKey}
            placeholder={draft.id ? t('output.streamKeyKeep') : ''}
            onChange={(event) => setDraft({ ...draft, streamKey: event.target.value })}
          />
        </label>
        <div className="output-actions">
        <label className="tts-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          {t('output.enabled')}
        </label>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? t('output.saving') : draft.id ? t('output.save') : t('output.add')}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setDraft({
                id: null,
                platform: 'custom',
                label: '本地 RTMP',
                serverUrl: 'rtmp://127.0.0.1:1935/live',
                streamKey: 'preview',
                enabled: false,
              })
            }
          >
            {t('output.localFill')}
          </button>
          {liveId ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                void api.restartOutput().then(setOutput).catch((reason) => setError(explainError(t, reason)));
              }}
            >
              {t('output.restart')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function statusKey(status: OutputPushStatus): MessageKey {
  return `output.status.${status}`;
}
