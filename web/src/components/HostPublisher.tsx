import { useEffect, useRef, useState } from 'react';
import type { RealtimeDataPacket, RealtimeJoin } from '@lingbo/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import { startBroadcast } from '../realtime/canvas';
import { connectLiveKit, type LiveKitHandle } from '../realtime/connect';

type Phase = 'idle' | 'publish' | 'agent' | 'failed' | 'local';

export function HostPublisher({
  sessionId,
  hostName,
  caption,
  productTitle,
  speaking,
  audioUrl,
  speechToken,
  relay,
  onComment,
}: {
  sessionId: string;
  hostName: string;
  caption: string;
  productTitle: string;
  speaking: boolean;
  audioUrl: string | null;
  speechToken: number;
  relay: { nonce: number; packet: RealtimeDataPacket } | null;
  onComment: (packet: RealtimeDataPacket) => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<LiveKitHandle | null>(null);
  const audioRef = useRef<{ context: AudioContext; destination: MediaStreamAudioDestinationNode } | null>(null);
  const commentRef = useRef(onComment);
  commentRef.current = onComment;
  const relayRef = useRef(relay);
  relayRef.current = relay;
  const frameRef = useRef({ host: hostName, caption, product: productTitle, speaking });
  frameRef.current = { host: hostName, caption, product: productTitle, speaking };
  const [phase, setPhase] = useState<Phase>('idle');
  const [join, setJoin] = useState<RealtimeJoin | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('idle');
    api
      .rtc(sessionId, { role: 'host', name: hostName })
      .then(({ join: next }) => {
        if (cancelled) return;
        setJoin(next);
        if (next.provider !== 'livekit') setPhase('local');
        else setPhase(next.publishMedia ? 'publish' : 'agent');
      })
      .catch(() => {
        if (!cancelled) setPhase('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, hostName]);

  useEffect(() => {
    if (phase !== 'publish' && phase !== 'agent') return;
    if (!join || join.provider !== 'livekit') return;
    const canvas = canvasRef.current;
    let broadcast: ReturnType<typeof startBroadcast> = null;
    let handle: LiveKitHandle | null = null;
    let audio: AudioContext | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        handle = await connectLiveKit(join, (packet) => {
          if (packet.type === 'comment') commentRef.current(packet);
        }, () => undefined);
        if (cancelled) {
          await handle.disconnect();
          return;
        }
        handleRef.current = handle;
        const pending = relayRef.current?.packet;
        if (pending) await handle.publishPacket(pending).catch(() => undefined);
        if (phase === 'publish') {
          if (!canvas) throw new Error('canvas');
          broadcast = startBroadcast(canvas, () => frameRef.current);
          if (!broadcast?.video) throw new Error('capture');
          await handle.publishCamera(broadcast.video);
          audio = new AudioContext();
          const destination = audio.createMediaStreamDestination();
          const mic = destination.stream.getAudioTracks()[0];
          if (mic) await handle.publishMicrophone(mic);
          audioRef.current = { context: audio, destination };
        }
      } catch {
        if (!cancelled) setPhase('failed');
      }
    };

    void run();
    return () => {
      cancelled = true;
      broadcast?.stop();
      audioRef.current = null;
      void handle?.disconnect();
      void audio?.close();
      handleRef.current = null;
    };
  }, [phase, join]);

  useEffect(() => {
    const packet = relay?.packet;
    const handle = handleRef.current;
    if (!packet || !handle) return;
    void handle.publishPacket(packet).catch(() => undefined);
  }, [relay]);

  useEffect(() => {
    const sink = audioRef.current;
    if (!audioUrl || !speechToken || !sink) return;
    let source: AudioBufferSourceNode | null = null;
    let stopped = false;
    const play = async () => {
      const response = await fetch(audioUrl);
      const decoded = await sink.context.decodeAudioData(await response.arrayBuffer());
      if (stopped) return;
      source = sink.context.createBufferSource();
      source.buffer = decoded;
      source.connect(sink.destination);
      source.start();
    };
    void play().catch(() => undefined);
    return () => {
      stopped = true;
      try {
        source?.stop();
      } catch {
        // already finished
      }
    };
  }, [audioUrl, speechToken]);

  if (phase === 'idle' || phase === 'local') return null;

  return (
    <div className="broadcast">
      <div className="monitor-head">
        <h3>{t('realtime.preview')}</h3>
        <span className={phase === 'publish' || phase === 'agent' ? 'pill live' : 'pill'}>
          {phase === 'failed' ? t('realtime.failed') : phase === 'agent' ? t('realtime.agent') : t('realtime.connected')}
        </span>
      </div>
      {phase === 'publish' ? <canvas ref={canvasRef} className="broadcast-canvas" /> : null}
    </div>
  );
}
