import type { HostFace } from './hosts';

export type VisemeShape = 'rest' | 'closed' | 'open' | 'wide' | 'round';

export interface VisemeFrame {
  shape: VisemeShape;
  openness: number;
}

const CLOSED = new Set(['，', '。', '、', '！', '？', '…', ' ', '\n', '\t', ',', '.', '!', '?', '；', ';', '：', ':', '—', '～', '~']);

export function visemeAt(text: string, elapsedMs: number, durationMs: number): VisemeFrame {
  if (durationMs <= 0 || elapsedMs < 0 || elapsedMs >= durationMs) return { shape: 'rest', openness: 0 };
  const chars = [...text];
  if (chars.length === 0) return { shape: 'rest', openness: 0 };
  const index = Math.min(chars.length - 1, Math.floor((elapsedMs / durationMs) * chars.length));
  const char = chars[index] ?? '';
  if (CLOSED.has(char)) return { shape: 'closed', openness: 0.05 };
  const code = char.codePointAt(0) ?? 0;
  const openness = Math.min(0.85, Math.max(0.15, 0.35 + ((code * 17) % 50) / 100));
  const shape: VisemeShape = openness > 0.68 ? 'open' : openness > 0.48 ? 'wide' : 'round';
  return { shape, openness };
}

export function blendOpenness(viseme: number, amplitude: number | null): number {
  if (amplitude === null || amplitude < 0.02) return viseme;
  return Math.min(1, viseme * 0.25 + amplitude * 0.9);
}

export function blinkAmount(timeMs: number, seed = 0): number {
  const period = 3400 + (Math.abs(Math.round(seed)) % 5) * 260;
  const phase = (timeMs + seed * 90) % period;
  if (phase < 110) return Math.sin((phase / 110) * Math.PI);
  return 0;
}

export interface IdlePose {
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export function idlePose(timeMs: number, energy: number): IdlePose {
  const sway = Math.max(0, energy);
  return {
    x: Math.sin(timeMs / 1400) * 6 * sway,
    y: Math.cos(timeMs / 1700) * 3.2 * sway,
    rot: Math.sin(timeMs / 2200) * 0.55 * sway,
    scale: 1 + Math.sin(timeMs / 1600) * 0.008 * sway,
  };
}

export interface MouthBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function mouthBox(face: HostFace, frame: VisemeFrame): MouthBox {
  const widthScale = frame.shape === 'round' ? 0.72 : frame.shape === 'wide' ? 1.18 : frame.shape === 'closed' ? 0.84 : 1;
  const heightScale = frame.shape === 'round' ? 0.62 : frame.shape === 'wide' ? 0.4 : frame.shape === 'closed' ? 0.16 : 0.5;
  return {
    x: face.mouthX,
    y: face.mouthY,
    w: face.mouthW * widthScale,
    h: Math.max(0.008, face.mouthW * heightScale * Math.max(frame.openness, frame.shape === 'closed' ? 0.35 : 0)),
  };
}
