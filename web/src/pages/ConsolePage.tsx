import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_PERSONA,
  TONES,
  formatDuration,
  formatYuan,
  type LiveSession,
  type Persona,
  type Product,
  type RealtimeDataPacket,
  type Script,
} from '@lingbo/shared';
import { api } from '../api';
import { CommentList } from '../components/CommentList';
import { HostPublisher } from '../components/HostPublisher';
import { OutputPanel } from '../components/OutputPanel';
import { explainError, useI18n } from '../i18n';
import type { MessageKey } from '../i18n/zh-CN';
import { applyLiveEvent, emptyRoom, optimisticComment, type RoomState } from '../liveState';
import { useLiveChannel } from '../useLiveChannel';

const RATES: Array<{ value: number; key: MessageKey }> = [
  { value: 0.85, key: 'rate.slow' },
  { value: 1, key: 'rate.normal' },
  { value: 1.2, key: 'rate.fast' },
];

export function ConsolePage() {
  const { t, locale } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [persona, setPersona] = useState<Persona>(DEFAULT_PERSONA);
  const [selected, setSelected] = useState<string[]>([]);
  const [script, setScript] = useState<Script | null>(null);
  const [room, setRoom] = useState<RoomState>(emptyRoom);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'start' | 'stop' | 'save' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [relay, setRelay] = useState<{ nonce: number; packet: RealtimeDataPacket } | null>(null);
  const relayNonce = useRef(0);

  const liveId = room.session?.status === 'live' ? room.session.id : null;

  const pushRelay = (packet: RealtimeDataPacket) => {
    relayNonce.current += 1;
    setRelay({ nonce: relayNonce.current, packet });
  };

  useLiveChannel(liveId, (event) => {
    setRoom((state) => applyLiveEvent(state, event));
    if (event.type === 'script') setScript(event.script);
    if (event.type === 'status') {
      setSessions((current) => current.map((item) => (item.id === event.session.id ? event.session : item)));
    }
    if (event.type === 'speech') {
      pushRelay({
        v: 1,
        type: 'speech',
        text: event.text,
        purpose: event.purpose,
        durationMs: event.durationMs,
        productId: event.productId,
      });
    }
    if (event.type === 'comment') {
      pushRelay({
        v: 1,
        type: 'comment',
        clientId: event.comment.clientId ?? event.comment.id,
        name: event.comment.viewerName,
        text: event.comment.text,
      });
    }
  });

  useEffect(() => {
    if (!room.speech) return;
    setSpeaking(true);
    const timer = window.setTimeout(() => setSpeaking(false), room.speech.durationMs);
    return () => window.clearTimeout(timer);
  }, [room.speech]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.products(), api.settings(), api.sessions()])
      .then(async ([catalog, settings, history]) => {
        if (cancelled) return;
        setProducts(catalog.products);
        setPersona(settings.persona);
        setSessions(history.sessions);
        const live = history.sessions.find((session) => session.status === 'live');
        if (!live) return;
        const [detail, comments] = await Promise.all([api.session(live.id), api.comments(live.id)]);
        if (cancelled) return;
        setRoom({
          session: detail.session,
          product: detail.product,
          comments: comments.comments,
          connections: 0,
          speech: null,
          script: null,
        });
        setSelected(detail.session.productIds);
        setPersona(detail.session.persona);
      })
      .catch((reason) => {
        if (!cancelled) setError(explainError(t, reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const personaPayload = (): Persona | null => {
    if (!persona.name.trim()) {
      setError(t('console.needName'));
      return null;
    }
    return { ...persona, name: persona.name.trim(), extraNotes: persona.extraNotes.trim() };
  };

  const toggle = (id: string) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const move = (id: string, direction: -1 | 1) => {
    setSelected((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
  };

  const preview = async () => {
    const nextPersona = personaPayload();
    const productId = selected[0];
    if (!nextPersona || !productId) {
      if (!productId) setError(t('console.needSelection'));
      return;
    }
    setBusy('preview');
    setError('');
    try {
      const { script: next } = await api.preview({ productId, persona: nextPersona });
      setScript(next);
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const nextPersona = personaPayload();
    if (!nextPersona) return;
    if (selected.length === 0) {
      setError(t('console.needSelection'));
      return;
    }
    setBusy('start');
    setError('');
    setMessage('');
    try {
      const { session } = await api.start({ productIds: selected, persona: nextPersona });
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setRoom({ ...emptyRoom(), session });
      setScript(null);
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!liveId) return;
    setBusy('stop');
    setError('');
    try {
      const { session } = await api.stop(liveId);
      setRoom((state) => ({ ...state, session }));
      setSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
      setSpeaking(false);
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(null);
    }
  };

  const savePersona = async () => {
    const nextPersona = personaPayload();
    if (!nextPersona) return;
    setBusy('save');
    setError('');
    try {
      const { persona: saved } = await api.saveSettings(nextPersona);
      setPersona(saved);
      setMessage(t('console.personaSaved'));
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(null);
    }
  };

  const ordered = [
    ...selected.map((id) => products.find((product) => product.id === id)).filter((product): product is Product => !!product),
    ...products.filter((product) => !selected.includes(product.id)),
  ];
  const caption = room.speech?.text || room.session?.currentCaption || '';
  const stats = room.session?.stats;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('console.eyebrow')}</p>
          <h1>{t('console.title')}</h1>
          <p className="lede">{t('console.lede')}</p>
        </div>
        <div className="hero-actions">
          <span className={liveId ? 'pill live' : 'pill'}>{liveId ? t('console.liveNow') : t('console.noneLive')}</span>
          {liveId ? (
            <button type="button" className="btn danger" onClick={() => void stop()} disabled={busy !== null}>
              {busy === 'stop' ? t('console.stopping') : t('console.stop')}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void start()} disabled={busy !== null || products.length === 0}>
              {busy === 'start' ? t('console.starting') : t('console.start')}
            </button>
          )}
          {liveId ? (
            <Link className="btn ghost" to={`/live/${liveId}`} target="_blank" rel="noreferrer">
              {t('console.openRoom')}
            </Link>
          ) : null}
        </div>
      </header>
      {locale === 'en' ? <p className="help">{t('generatedLanguageHint')}</p> : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="status-line" role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p>{t('common.loading')}</p> : null}
      {products.length === 0 && !loading ? (
        <p className="empty">
          {t('console.needProduct')} <Link to="/products">{t('console.goProducts')}</Link>
        </p>
      ) : null}

      <div className="grid-2">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void savePersona();
          }}
        >
          <h2>{t('console.persona')}</h2>
          <label className="field">
            <span>{t('console.hostName')}</span>
            <input id="host-name" value={persona.name} onChange={(event) => setPersona({ ...persona, name: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('console.tone')}</span>
            <select
              id="host-tone"
              value={persona.tone}
              onChange={(event) => setPersona({ ...persona, tone: event.target.value as Persona['tone'] })}
            >
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {t(`tone.${tone}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('console.rate')}</span>
            <select
              id="host-rate"
              value={String(persona.speechRate)}
              onChange={(event) => setPersona({ ...persona, speechRate: Number(event.target.value) })}
            >
              {RATES.map((rate) => (
                <option key={rate.value} value={rate.value}>
                  {t(rate.key)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('console.notes')}</span>
            <textarea
              id="host-notes"
              rows={3}
              value={persona.extraNotes}
              placeholder={t('console.notesPlaceholder')}
              onChange={(event) => setPersona({ ...persona, extraNotes: event.target.value })}
            />
          </label>
          <button type="submit" className="btn ghost" disabled={busy !== null}>
            {t('console.savePersona')}
          </button>
        </form>

        <div className="panel">
          <h2>{t('console.rotation')}</h2>
          <p className="help">{t('console.rotationHint')}</p>
          <div className="check-list">
            {ordered.map((product) => {
              const index = selected.indexOf(product.id);
              const on = index >= 0;
              return (
                <div key={product.id} className={on ? 'check-item on' : 'check-item'}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => toggle(product.id)} disabled={!!liveId} />
                    <span>
                      <strong>{product.title}</strong>
                      <small>{formatYuan(product.priceYuan)}</small>
                    </span>
                  </label>
                  <em>{on ? t('console.selected', { index: index + 1 }) : t('console.unselected')}</em>
                  {on ? (
                    <span className="nudge">
                      <button type="button" onClick={() => move(product.id, -1)} disabled={!!liveId || index === 0}>
                        {t('console.moveUp')}
                      </button>
                      <button type="button" onClick={() => move(product.id, 1)} disabled={!!liveId || index === selected.length - 1}>
                        {t('console.moveDown')}
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn ghost" onClick={() => void preview()} disabled={busy !== null || !!liveId}>
            {busy === 'preview' ? t('console.previewing') : t('console.preview')}
          </button>
        </div>
      </div>

      {script ? (
        <section className="panel" id="script-preview">
          <h2>
            {t('console.scriptTitle')}
            <small>
              {' '}
              · {script.provider === 'openai' ? t('system.openai') : t('system.mock')}
            </small>
          </h2>
          <ol className="script-list">
            {script.segments.map((segment, index) => (
              <li key={`${segment.kind}-${index}`}>
                <span className="script-kind">{t(`kind.${segment.kind}`)}</span>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <OutputPanel liveId={liveId} />

      <section className="panel monitor">
        <header className="monitor-head">
          <h2>{t('console.monitor')}</h2>
          <span className={speaking ? 'pill live' : 'pill'}>{speaking ? t('speech.speaking') : t('speech.idle')}</span>
        </header>
        {liveId ? (
          <p className="room-link">
            {t('console.roomHint')}{' '}
            <Link to={`/live/${liveId}`}>{`/live/${liveId}`}</Link>
          </p>
        ) : null}
        <p className="caption-block" aria-live="polite">
          {room.speech ? <span className="script-kind">{t(room.speech.purpose === 'reply' ? 'speech.reply' : 'speech.script')}</span> : null}
          {caption || t('console.captionEmpty')}
        </p>
        <div className="stats">
          <Stat label={t('console.statsComments')} value={stats?.commentCount ?? 0} />
          <Stat label={t('console.statsReplies')} value={stats?.replyCount ?? 0} />
          <Stat label={t('console.statsShows')} value={stats?.productShows ?? 0} />
          <Stat label={t('console.statsSpeaking')} value={formatDuration(stats?.speakingMs ?? 0)} />
          <Stat label={t('console.statsOnline')} value={room.connections} />
          <Stat label={t('console.statsAudience')} value={stats?.demoAudience ?? 0} />
        </div>
        {liveId ? (
          <HostPublisher
            sessionId={liveId}
            hostName={room.session?.persona.name ?? persona.name}
            caption={caption}
            productTitle={room.product?.title ?? ''}
            speaking={speaking}
            audioUrl={room.speech?.audioUrl ?? null}
            speechToken={room.speech?.token ?? 0}
            relay={relay}
            onComment={(packet) => {
              if (!packet.clientId) return;
              setRoom((state) =>
                applyLiveEvent(state, {
                  type: 'comment',
                  comment: optimisticComment({
                    sessionId: liveId,
                    clientId: packet.clientId ?? '',
                    name: packet.name ?? '',
                    text: packet.text,
                  }),
                }),
              );
            }}
          />
        ) : null}
        <h3>{t('console.comments')}</h3>
        <CommentList comments={room.comments} hostName={room.session?.persona.name ?? persona.name} />
      </section>

      <section className="panel">
        <h2>{t('console.history')}</h2>
        {sessions.length === 0 ? <p className="empty">{t('console.noneHistory')}</p> : null}
        <ul className="history">
          {sessions.slice(0, 6).map((session) => (
            <li key={session.id}>
              <Link to={`/live/${session.id}`}>{session.persona.name}</Link>
              <span>{session.status === 'live' ? t('console.liveNow') : t('console.ended')}</span>
              <time>{new Date(session.startedAt).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en')}</time>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
