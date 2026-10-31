import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { formatYuan, type RealtimeJoin } from '@lingbo/shared';
import type { RemoteTrack } from 'livekit-client';
import { api } from '../api';
import { HostAvatar } from '../components/HostAvatar';
import { ProductCover } from '../components/ProductCover';
import { applyLiveEvent, emptyRoom } from '../liveState';
import { connectLiveKit } from '../realtime/connect';
import { useLiveChannel } from '../useLiveChannel';

export function ProgramPage() {
  const { sessionId = '' } = useParams();
  const [params] = useSearchParams();
  const [room, setRoom] = useState(emptyRoom);
  const [speaking, setSpeaking] = useState(false);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !videoTrack) return;
    videoTrack.attach(element);
    return () => {
      videoTrack.detach(element);
    };
  }, [videoTrack]);

  const session = room.session;
  const product = room.product;
  const caption = room.speech?.text || session?.currentCaption || '';
  const hostName = session?.persona.name || '小林';

  return (
    <div className="program-root">
      <div className="program-frame">
        <div className="program-stage">
          {videoTrack ? <video ref={videoRef} autoPlay playsInline muted={false} /> : <HostAvatar name={hostName} speaking={speaking} />}
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
