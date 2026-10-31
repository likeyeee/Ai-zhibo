import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_PERSONA,
  DEFAULT_SHOW,
  HOSTS,
  TONES,
  formatDuration,
  formatYuan,
  hostById,
  normalizeShow,
  type DirectorMode,
  type HostId,
  type LiveSession,
  type Persona,
  type Product,
  type RealtimeDataPacket,
  type SceneTemplate,
  type Script,
  type ShowControl,
} from '@lingbo/shared';
import { api } from '../api';
import { CommentList } from '../components/CommentList';
import { HostPublisher } from '../components/HostPublisher';
import { PhotoHost, type MouthCue } from '../components/PhotoHost';
import { OutputPanel } from '../components/OutputPanel';
import { explainError, useI18n } from '../i18n';
import type { MessageKey } from '../i18n/zh-CN';
import { applyLiveEvent, emptyRoom, optimisticComment, type RoomState } from '../liveState';
import { useLiveChannel } from '../useLiveChannel';

const HOST_COPY: Record<HostId, { name: MessageKey; voice: MessageKey; style: MessageKey }> = {
  lin: { name: 'host.lin.name', voice: 'host.lin.voice', style: 'host.lin.style' },
  heng: { name: 'host.heng.name', voice: 'host.heng.voice', style: 'host.heng.style' },
  ran: { name: 'host.ran.name', voice: 'host.ran.voice', style: 'host.ran.style' },
  chen: { name: 'host.chen.name', voice: 'host.chen.voice', style: 'host.chen.style' },
};

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
  const [demo, setDemo] = useState<MouthCue | null>(null);
  const [demoSpeaking, setDemoSpeaking] = useState(false);
  const [relay, setRelay] = useState<{ nonce: number; packet: RealtimeDataPacket } | null>(null);
  const [draftShow, setDraftShow] = useState<ShowControl>(DEFAULT_SHOW);
  const [insertText, setInsertText] = useState('');
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
        setDraftShow(detail.session.show);
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

  const chooseHost = (id: HostId) => {
    const host = hostById(id);
    setPersona((current) => ({
      ...current,
      hostId: host.id,
      name: host.name,
      voice: host.voice,
      tone: host.tone,
      speechRate: host.speechRate,
    }));
  };

  const tryMouth = () => {
    setDemo({
      token: Date.now(),
      text: '家人们，这款的价格和卖点我放在画面下面。',
      durationMs: 2800,
      audioUrl: null,
      avatarVideoUrl: null,
    });
    setDemoSpeaking(true);
    window.setTimeout(() => setDemoSpeaking(false), 2800);
  };

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
      const { session } = await api.start({ productIds: selected, persona: nextPersona, show: draftShow });
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

  const show = liveId && room.session?.show ? room.session.show : draftShow;

  const applyShow = async (patch: Partial<ShowControl>) => {
    setError('');
    if (!liveId) {
      setDraftShow((current) => normalizeShow({ ...current, ...patch }));
      return;
    }
    try {
      const { session } = await api.control(liveId, patch);
      setRoom((state) => ({ ...state, session }));
      setDraftShow(session.show);
    } catch (reason) {
      setError(explainError(t, reason));
    }
  };

  const runAction = async (action: 'pause' | 'resume' | 'advance' | 'next' | 'insert', text?: string) => {
    if (!liveId) return;
    setError('');
    try {
      const { session } = await api.control(liveId, { action, text });
      setRoom((state) => ({ ...state, session }));
      if (action === 'insert') setInsertText('');
    } catch (reason) {
      setError(explainError(t, reason));
    }
  };

  const uploadPortrait = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const uploaded = await api.upload(file);
      await applyShow({ portraitUrl: uploaded.url });
    } catch (reason) {
      setError(explainError(t, reason));
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

      <section className="panel host-panel">
        <h2>{t('console.pickHost')}</h2>
        <p className="help">{liveId ? t('console.hostLocked') : t('console.pickHostHint')}</p>
        <div className="host-library">
          {HOSTS.map((host) => {
            const copy = HOST_COPY[host.id];
            const selectedHost = persona.hostId === host.id;
            return (
              <button
                key={host.id}
                type="button"
                className={selectedHost ? 'host-card on' : 'host-card'}
                aria-pressed={selectedHost}
                disabled={!!liveId}
                onClick={() => chooseHost(host.id)}
              >
                <img src={host.portrait} alt="" />
                <strong>{t(copy.name)}</strong>
                <small>{t(copy.voice)}</small>
                <em>{t(copy.style)}</em>
              </button>
            );
          })}
        </div>
        <div className="host-preview-row">
          <div className="host-preview">
            <PhotoHost
              hostId={liveId ? (room.session?.persona.hostId ?? persona.hostId) : persona.hostId}
              speaking={liveId ? speaking : demoSpeaking}
              cue={liveId ? room.speech : demo}
              syncAudio={false}
              portraitUrl={show.portraitUrl}
              scene={show.scene}
            />
          </div>
          <button type="button" className="btn ghost" onClick={tryMouth} disabled={!!liveId}>
            {t('console.tryMouth')}
          </button>
        </div>
      </section>

      <section className="panel" id="director">
        <h2>{t('show.title')}</h2>
        <p className="help">{t('show.hint')}</p>
        <p className="warn-banner">{t('show.loopWarning')}</p>
        <div className="director-grid">
          <label className="field">
            <span>{t('show.mode')}</span>
            <select
              id="show-mode"
              value={show.mode}
              onChange={(event) => void applyShow({ mode: event.target.value as DirectorMode })}
            >
              <option value="auto">{t('show.modeAuto')}</option>
              <option value="semi">{t('show.modeSemi')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('show.scene')}</span>
            <select
              id="show-scene"
              value={show.scene}
              onChange={(event) => void applyShow({ scene: event.target.value as SceneTemplate })}
            >
              <option value="studio">{t('show.sceneStudio')}</option>
              <option value="greenscreen">{t('show.sceneGreen')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('show.loop')}</span>
            <input type="checkbox" checked={show.loop} onChange={(event) => void applyShow({ loop: event.target.checked })} />
          </label>
          <label className="field">
            <span>{t('show.aiLabel')}</span>
            <input
              type="checkbox"
              checked={show.showAiLabel}
              onChange={(event) => void applyShow({ showAiLabel: event.target.checked })}
            />
          </label>
          <label className="field">
            <span>{t('show.portrait')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void uploadPortrait(file);
              }}
            />
          </label>
        </div>
        <p className="help">{show.scene === 'greenscreen' ? t('show.greenHint') : t('show.portraitHint')}</p>
        {show.portraitUrl ? (
          <button type="button" className="btn ghost" onClick={() => void applyShow({ portraitUrl: null })}>
            {t('show.clearPortrait')}
          </button>
        ) : null}
        <div className="director-actions">
          <button type="button" className="btn ghost" disabled={!liveId} onClick={() => void runAction(show.paused ? 'resume' : 'pause')}>
            {show.paused ? t('show.resume') : t('show.pause')}
          </button>
          <button type="button" className="btn ghost" disabled={!liveId} onClick={() => void runAction('advance')}>
            {t('show.advance')}
          </button>
          <button type="button" className="btn ghost" disabled={!liveId} onClick={() => void runAction('next')}>
            {t('show.nextProduct')}
          </button>
        </div>
        <form
          className="director-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (insertText.trim()) void runAction('insert', insertText.trim());
          }}
        >
          <input
            id="insert-line"
            value={insertText}
            maxLength={200}
            placeholder={t('show.insertPlaceholder')}
            onChange={(event) => setInsertText(event.target.value)}
            disabled={!liveId}
          />
          <button type="submit" className="btn primary" disabled={!liveId || !insertText.trim()}>
            {t('show.insert')}
          </button>
        </form>
      </section>

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
            hostId={room.session?.persona.hostId ?? persona.hostId}
            hostName={room.session?.persona.name ?? persona.name}
            caption={caption}
            productTitle={room.product?.title ?? ''}
            speaking={speaking}
            audioUrl={room.speech?.audioUrl ?? null}
            speechToken={room.speech?.token ?? 0}
            speechDurationMs={room.speech?.durationMs ?? 0}
            portraitUrl={room.session?.show.portraitUrl ?? null}
            scene={room.session?.show.scene ?? 'studio'}
            showAiLabel={room.session?.show.showAiLabel !== false}
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
