import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { formatYuan, type RealtimeJoin } from '@lingbo/shared';
import type { RemoteTrack } from 'livekit-client';
import { api } from '../api';
import { HostStage } from '../components/PhotoHost';
import { ProductCover } from '../components/ProductCover';
import { useI18n } from '../i18n';
import { applyLiveEvent, emptyRoom } from '../liveState';
import { connectLiveKit } from '../realtime/connect';
import { useLiveChannel } from '../useLiveChannel';

export function ProgramPage() {
  const { t } = useI18n();
  const { sessionId = '' } = useParams();
  const [params] = useSearchParams();
  const [room, setRoom] = useState(emptyRoom);
  const [speaking, setSpeaking] = useState(false);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [loopUrl, setLoopUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useLiveChannel(sessionId || null, (event) => setRoom((state) => applyLiveEvent(state, event)));

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.session(sessionId), api.comments(sessionId)])
      .then(([detail, comments]) => {
        if (cancelled) return;
        setRoom({
          session: detail.session,
          product: detail.product,
          comments: comments.comments,
          connections: 0,
          speech: null,
          script: null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!room.speech) return;
    setSpeaking(true);
    const timer = window.setTimeout(() => setSpeaking(false), room.speech.durationMs);
    return () => window.clearTimeout(timer);
  }, [room.speech]);

  useEffect(() => {
    api
      .system()
      .then((system) => setLoopUrl(system.avatar.videoUrl))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    console.log('START_RECORDING');
    return () => {
      console.log('END_RECORDING');
    };
  }, []);

  useEffect(() => {
    const url = params.get('url');
    const token = params.get('token');
    if (!url || !token) return;
    let cancelled = false;
    const join: RealtimeJoin = {
      provider: 'livekit',
      url,
      token,
      room: null,
      role: 'viewer',
      publishMedia: false,
      hostPublisher: 'browser',
    };
    let handle: Awaited<ReturnType<typeof connectLiveKit>> | null = null;
    connectLiveKit(join, () => undefined, (kind, track) => {
      if (cancelled) return;
      if (kind === 'video') setVideoTrack(track);
      if (kind === 'audio' && audioRef.current) track.attach(audioRef.current);
    })
      .then((next) => {
        handle = next;
        if (cancelled) void next.disconnect();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void handle?.disconnect();
    };
  }, [params]);

  const session = room.session;
  const product = room.product;
  const caption = room.speech?.text || session?.currentCaption || '';
  const hostName = session?.persona.name || '小林';
  const hostId = session?.persona.hostId || 'lin';
  const clip = room.speech?.avatarVideoUrl || null;
  const showAiLabel = session?.show.showAiLabel !== false;
  const scene = session?.show.scene ?? 'studio';
  const portraitUrl = session?.show.portraitUrl ?? null;

  return (
    <div className="program-root">
      <div className="program-frame">
        <div className="program-stage">
          <HostStage
            hostId={hostId}
            speaking={speaking}
            cue={room.speech}
            remoteTrack={videoTrack}
            loopUrl={loopUrl}
            syncAudio={!params.get('url') && !clip && !videoTrack}
            portraitUrl={portraitUrl}
            scene={scene}
          />
          {showAiLabel ? <p className="ai-label">{t('show.badge')}</p> : null}
          <audio ref={audioRef} autoPlay />
        </div>
        <div className="program-lower">
          <p className="program-caption">{caption}</p>
          <div className="program-card">
            <div className="cover">
              <ProductCover title={product?.title || hostName} imageUrl={product?.imageUrl ?? null} />
            </div>
            <div>
              <strong>{product?.title || hostName}</strong>
              <em>{product ? formatYuan(product.priceYuan) : ''}</em>
            </div>
          </div>
        </div>
        <p className="program-name">{hostName}</p>
      </div>
    </div>
  );
}
