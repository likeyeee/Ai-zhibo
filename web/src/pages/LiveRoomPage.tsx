import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatYuan, type RealtimeDataPacket } from '@lingbo/shared';
import type { RemoteTrack } from 'livekit-client';
import { api } from '../api';
import { CommentList } from '../components/CommentList';
import { HostAvatar } from '../components/HostAvatar';
import { ProductCover } from '../components/ProductCover';
import { useSystem } from '../components/Layout';
import { explainError, useI18n } from '../i18n';
import { applyLiveEvent, emptyRoom, optimisticComment } from '../liveState';
import { connectLiveKit, type LiveKitHandle } from '../realtime/connect';
import { useLiveChannel } from '../useLiveChannel';

export function LiveRoomPage() {
  const { sessionId = '' } = useParams();
  const { t } = useI18n();
  const system = useSystem();
  const [room, setRoom] = useState(emptyRoom);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState(() => localStorage.getItem('lingbo.nick') ?? '');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [browserTts, setBrowserTts] = useState(() => localStorage.getItem('lingbo.tts') !== '0');
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [remoteAudio, setRemoteAudio] = useState(false);
  const [rtcMode, setRtcMode] = useState<'local' | 'connecting' | 'livekit' | 'failed'>('local');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rtcRef = useRef<LiveKitHandle | null>(null);

  useLiveChannel(sessionId || null, (event) => setRoom((state) => applyLiveEvent(state, event)));

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.session(sessionId), api.comments(sessionId)])
      .then(([detail, comments]) => {
        if (cancelled) return;
        setRoom((state) => ({
          ...state,
          session: detail.session,
          product: detail.product ?? state.product,
          comments: comments.comments,
        }));
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 404) setMissing(true);
        else setError(explainError(t, reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, t]);

  useEffect(() => {
    if (!room.speech) return;
    setSpeaking(true);
    const timer = window.setTimeout(() => setSpeaking(false), Math.max(600, room.speech.durationMs));
    return () => window.clearTimeout(timer);
  }, [room.speech]);

  useEffect(() => {
    let handle: LiveKitHandle | null = null;
    let cancelled = false;
    const accept = (packet: RealtimeDataPacket) => {
      if (packet.type !== 'comment' || !packet.clientId || !packet.text) return;
      setRoom((state) =>
        applyLiveEvent(state, {
          type: 'comment',
          comment: optimisticComment({
            sessionId,
            clientId: packet.clientId ?? '',
            name: packet.name ?? '',
            text: packet.text,
          }),
        }),
      );
    };
    api
      .rtc(sessionId, { role: 'viewer', name: localStorage.getItem('lingbo.nick') || '观众' })
      .then(async ({ join }) => {
        if (cancelled) return;
        if (join.provider !== 'livekit') {
          setRtcMode('local');
          return;
        }
        setRtcMode('connecting');
        handle = await connectLiveKit(join, accept, (kind, track) => {
          if (kind === 'video') setVideoTrack(track);
          if (kind === 'audio') {
            const element = audioRef.current;
            if (element) track.attach(element);
            setRemoteAudio(true);
          }
        });
        if (cancelled) {
          await handle.disconnect();
          return;
        }
        rtcRef.current = handle;
        setRtcMode('livekit');
      })
      .catch(() => {
        if (!cancelled) setRtcMode('failed');
      });
    return () => {
      cancelled = true;
      rtcRef.current = null;
      void handle?.disconnect();
    };
  }, [sessionId]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !videoTrack) return;
    videoTrack.attach(element);
    return () => {
      videoTrack.detach(element);
    };
  }, [videoTrack]);

  useEffect(() => {
    const speech = room.speech;
    if (!speech || remoteAudio) return;
    if (speech.audioUrl) {
      const audio = new Audio(speech.audioUrl);
      void audio.play().catch(() => undefined);
      return () => audio.pause();
    }
    if (!browserTts || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(speech.text);
    utterance.lang = 'zh-CN';
    utterance.rate = room.session?.persona.speechRate ?? 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [room.speech, browserTts, room.session?.persona.speechRate, remoteAudio]);

  const send = async () => {
    const body = text.trim();
    if (!body || !room.session || room.session.status !== 'live') return;
    const clientId = crypto.randomUUID();
    const name = nickname.trim();
    setSending(true);
    setError('');
    setRoom((state) =>
      applyLiveEvent(state, {
        type: 'comment',
        comment: optimisticComment({ sessionId, clientId, name, text: body }),
      }),
    );
    try {
      localStorage.setItem('lingbo.nick', nickname);
      void rtcRef.current
        ?.publishPacket({ v: 1, type: 'comment', clientId, name, text: body })
        .catch(() => undefined);
      const { comment } = await api.comment(sessionId, { viewerName: name || undefined, text: body, clientId });
      setRoom((state) => applyLiveEvent(state, { type: 'comment', comment }));
      setText('');
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setSending(false);
    }
  };

  if (missing) {
    return (
      <section className="page">
        <h1>{t('live.missing')}</h1>
        <Link to="/">{t('live.back')}</Link>
      </section>
    );
  }

  const session = room.session;
  const hostName = session?.persona.name ?? t('comment.host');
  const caption = room.speech?.text || session?.currentCaption || '';
  const videoUrl = system?.avatar.videoUrl ?? null;
  const live = session?.status === 'live';

  return (
    <section className="live-page">
      <p className="preview-note">{t('live.previewBanner')}</p>
      <header className="live-top">
        <Link to="/">{t('live.back')}</Link>
        <span className={live ? 'pill live' : 'pill'}>{live ? t('console.liveNow') : t('console.ended')}</span>
        <span>{t('live.online', { count: room.connections })}</span>
        <span>{t('live.audience', { count: session?.stats.demoAudience ?? 0 })}</span>
        <span className="pill">
          {rtcMode === 'livekit' ? t('realtime.connected') : rtcMode === 'failed' ? t('realtime.failed') : rtcMode === 'connecting' ? t('realtime.connecting') : t('realtime.local')}
        </span>
        <label className="tts-toggle">
          <input
            type="checkbox"
            checked={browserTts}
            onChange={(event) => {
              setBrowserTts(event.target.checked);
              localStorage.setItem('lingbo.tts', event.target.checked ? '1' : '0');
            }}
          />
          {t('live.browserTts')}
        </label>
      </header>
      {!live && session ? <p className="status-line">{t('live.endedBanner')}</p> : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      <p className="help tts-hint">{t('live.browserTtsHint')}</p>
      <div className="live-shell">
        <div className="stage-column">
          <div className={speaking ? 'stage speaking' : 'stage'}>
            <div className="spotlight" />
            <audio ref={audioRef} autoPlay />
            {videoTrack ? (
              <video ref={videoRef} className="avatar-video" autoPlay playsInline />
            ) : videoUrl ? (
              <video className="avatar-video" src={videoUrl} autoPlay muted={browserTts} loop playsInline />
            ) : (
              <HostAvatar name={hostName} speaking={speaking} />
            )}
            <div className="nameplate">
              <b>{hostName}</b>
              <span>{speaking ? t('speech.speaking') : t('speech.idle')}</span>
            </div>
            <div className="wave" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <p className="caption-block stage-caption" aria-live="polite">
            {room.speech ? <span className="script-kind">{t(room.speech.purpose === 'reply' ? 'speech.reply' : 'speech.script')}</span> : null}
            {caption || t('live.captionIdle')}
          </p>
          <article className="ticket">
            {room.product ? (
              <>
                <div className="cover">
                  <ProductCover title={room.product.title} imageUrl={room.product.imageUrl} />
                </div>
                <div>
                  <span className="script-kind">{t('live.selling')}</span>
                  <h2>{room.product.title}</h2>
                  <p className="price">{formatYuan(room.product.priceYuan)}</p>
                  <ul>
                    {room.product.sellingPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="empty">{t('live.productEmpty')}</p>
            )}
          </article>
        </div>
        <aside className="chat-pane">
          <h2>{t('live.chat')}</h2>
          <CommentList comments={room.comments} hostName={hostName} />
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label>
              <span>{t('live.nickname')}</span>
              <input
                id="viewer-name"
                value={nickname}
                placeholder={t('live.placeholderNick')}
                maxLength={20}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
            <label>
              <span>{t('live.chat')}</span>
              <input
                id="comment-text"
                value={text}
                placeholder={t('live.placeholder')}
                maxLength={200}
                disabled={!live}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button type="submit" className="btn primary" disabled={!live || sending || !text.trim()}>
              {sending ? t('live.sending') : t('live.send')}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
