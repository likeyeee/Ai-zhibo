import { useEffect, useRef } from 'react';
import type { RemoteTrack } from 'livekit-client';
import {
  STUDIO_BACKGROUND,
  blendOpenness,
  blinkAmount,
  hostById,
  idlePose,
  mouthBox,
  visemeAt,
  type SceneTemplate,
  type VisemeFrame,
} from '@lingbo/shared';

export interface MouthCue {
  token: number;
  text: string;
  durationMs: number;
  audioUrl: string | null;
  avatarVideoUrl?: string | null;
}

export function PhotoHost({
  hostId,
  speaking,
  cue,
  syncAudio = false,
  portraitUrl = null,
  scene = 'studio',
}: {
  hostId: string;
  speaking: boolean;
  cue: MouthCue | null;
  syncAudio?: boolean;
  portraitUrl?: string | null;
  scene?: SceneTemplate;
}) {
  const host = hostById(hostId);
  const talentRef = useRef<HTMLDivElement>(null);
  const mouthRef = useRef<HTMLDivElement>(null);
  const leftLid = useRef<HTMLDivElement>(null);
  const rightLid = useRef<HTMLDivElement>(null);
  const cueRef = useRef(cue);
  const speakingRef = useRef(speaking);
  const startedRef = useRef(0);
  const tokenRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const samplesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  cueRef.current = cue;
  speakingRef.current = speaking;
  if (cue && cue.token !== tokenRef.current) {
    tokenRef.current = cue.token;
    startedRef.current = performance.now();
  }

  useEffect(() => {
    if (!syncAudio || !cue?.audioUrl) return;
    const audio = new Audio(cue.audioUrl);
    audio.crossOrigin = 'anonymous';
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(context.destination);
    analyserRef.current = analyser;
    samplesRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    void context.resume().catch(() => undefined);
    void audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      analyserRef.current = null;
      samplesRef.current = null;
      void context.close();
    };
  }, [syncAudio, cue?.audioUrl, cue?.token]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = 0;
    const readLevel = (): number | null => {
      const analyser = analyserRef.current;
      const samples = samplesRef.current;
      if (!analyser || !samples) return null;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      return Math.min(1, Math.sqrt(sum / samples.length) * 3.4);
    };
    const draw = (now: number) => {
      const pose = reduce ? { x: 0, y: 0, rot: 0, scale: 1 } : idlePose(now, host.motion);
      const talent = talentRef.current;
      if (talent) {
        talent.style.transform = `translate(calc(-50% + ${pose.x}px), ${pose.y}px) rotate(${pose.rot}deg) scale(${pose.scale})`;
      }
      const blink = reduce ? 0 : blinkAmount(now, host.motion * 10);
      const lidH = blink * host.face.eyeW * 0.7;
      for (const lid of [leftLid.current, rightLid.current]) {
        if (!lid) continue;
        lid.style.height = `${lidH * 100}%`;
        lid.style.opacity = blink > 0.05 ? '0.96' : '0';
      }
      const current = cueRef.current;
      let frame: VisemeFrame = { shape: 'rest', openness: 0 };
      if (speakingRef.current && current) {
        const viseme = visemeAt(current.text, now - startedRef.current, current.durationMs);
        frame = { shape: viseme.shape, openness: blendOpenness(viseme.openness, readLevel()) };
      }
      const box = mouthBox(host.face, frame);
      const mouth = mouthRef.current;
      if (mouth) {
        const visible = speakingRef.current && (frame.openness > 0.08 || frame.shape === 'closed');
        mouth.style.opacity = visible ? '0.92' : '0';
        mouth.style.width = `${box.w * 100}%`;
        mouth.style.height = `${Math.max(box.h, 0.01) * 100}%`;
        mouth.style.left = `${box.x * 100}%`;
        mouth.style.top = `${box.y * 100}%`;
      }
      timer = window.requestAnimationFrame(draw);
    };
    timer = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(timer);
  }, [host]);

  return (
    <div className={speaking ? `photo-host speaking scene-${scene}` : `photo-host scene-${scene}`} data-host={host.id}>
      {scene === 'greenscreen' ? null : <img className="studio" src={STUDIO_BACKGROUND} alt="" />}
      <div className="talent" ref={talentRef}>
        <img className="portrait" src={portraitUrl || host.portrait} alt={host.name} />
        <div
          ref={leftLid}
          className="lid"
          style={{
            left: `${host.face.eyeLeftX * 100}%`,
            top: `${host.face.eyeY * 100}%`,
            width: `${host.face.eyeW * 100}%`,
            background: host.face.lid,
          }}
        />
        <div
          ref={rightLid}
          className="lid"
          style={{
            left: `${host.face.eyeRightX * 100}%`,
            top: `${host.face.eyeY * 100}%`,
            width: `${host.face.eyeW * 100}%`,
            background: host.face.lid,
          }}
        />
        <div ref={mouthRef} className="photo-mouth" />
      </div>
    </div>
  );
}

export function HostStage({
  hostId,
  speaking,
  cue,
  remoteTrack,
  loopUrl,
  syncAudio,
  portraitUrl = null,
  scene = 'studio',
}: {
  hostId: string;
  speaking: boolean;
  cue: MouthCue | null;
  remoteTrack: RemoteTrack | null;
  loopUrl: string | null;
  syncAudio: boolean;
  portraitUrl?: string | null;
  scene?: SceneTemplate;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = cue?.avatarVideoUrl || null;

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !remoteTrack) return;
    remoteTrack.attach(element);
    return () => {
      remoteTrack.detach(element);
    };
  }, [remoteTrack]);

  if (remoteTrack) {
    return (
      <div className="photo-host remote">
        <video ref={videoRef} autoPlay playsInline />
      </div>
    );
  }
  if (clip) {
    return (
      <div className={`photo-host remote scene-${scene}`}>
        {scene === 'greenscreen' ? null : <img className="studio" src={STUDIO_BACKGROUND} alt="" />}
        <video key={clip} className="talking-head" src={clip} autoPlay playsInline />
      </div>
    );
  }
  if (loopUrl) {
    return (
      <div className="photo-host remote">
        <video className="talking-head" src={loopUrl} autoPlay muted loop playsInline />
      </div>
    );
  }
  return <PhotoHost hostId={hostId} speaking={speaking} cue={cue} syncAudio={syncAudio} portraitUrl={portraitUrl} scene={scene} />;
}
