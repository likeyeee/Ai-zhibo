import { STUDIO_BACKGROUND, blinkAmount, hostById, idlePose, mouthBox, visemeAt, type SceneTemplate } from '@lingbo/shared';

export interface BroadcastFrame {
  hostId: string;
  host: string;
  caption: string;
  product: string;
  speaking: boolean;
  speechText: string;
  speechStartedAt: number;
  speechDurationMs: number;
  portraitUrl?: string | null;
  scene?: SceneTemplate;
  showAiLabel?: boolean;
}

const images = new Map<string, HTMLImageElement>();

export function startBroadcast(canvas: HTMLCanvasElement, read: () => BroadcastFrame) {
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') return null;
  canvas.width = 960;
  canvas.height = 540;
  let timer = 0;
  const draw = () => {
    paint(context, read(), performance.now());
    timer = window.requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(20);
  return {
    video: stream.getVideoTracks()[0] ?? null,
    stop() {
      window.cancelAnimationFrame(timer);
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function paint(context: CanvasRenderingContext2D, frame: BroadcastFrame, now: number) {
  const { width, height } = context.canvas;
  if (frame.scene === 'greenscreen') {
    context.fillStyle = '#00b140';
    context.fillRect(0, 0, width, height);
  } else {
    const studio = image(STUDIO_BACKGROUND);
    if (studio) context.drawImage(studio, 0, 0, width, height);
    else {
      context.fillStyle = '#241810';
      context.fillRect(0, 0, width, height);
    }
  }

  const host = hostById(frame.hostId);
  const pose = idlePose(now, host.motion);
  const portrait = image(frame.portraitUrl || host.portrait);
  const ph = height * 1.08 * pose.scale;
  const pw = ph * 0.75;
  const px = width / 2 - pw / 2 + pose.x;
  const py = height - ph + 8 + pose.y * 0.35;
  context.save();
  context.translate(px + pw / 2, py + ph * 0.72);
  context.rotate((pose.rot * Math.PI) / 180);
  context.translate(-(px + pw / 2), -(py + ph * 0.72));
  if (portrait) context.drawImage(portrait, px, py, pw, ph);
  else {
    context.fillStyle = '#3a2a22';
    context.fillRect(px, py, pw, ph);
    context.fillStyle = '#f6efe4';
    context.font = '28px sans-serif';
    context.fillText(host.name, px + 24, py + 48);
  }

  const viseme = frame.speaking
    ? visemeAt(frame.speechText || frame.caption, Math.max(0, now - frame.speechStartedAt), frame.speechDurationMs || 1)
    : { shape: 'rest' as const, openness: 0 };
  const blink = blinkAmount(now, host.motion * 10);
  if (blink > 0.08) {
    context.fillStyle = host.face.lid;
    const ew = host.face.eyeW * pw;
    const eh = ew * 0.62 * blink;
    context.beginPath();
    context.ellipse(px + host.face.eyeLeftX * pw, py + host.face.eyeY * ph, ew / 2, eh / 2, 0, 0, Math.PI * 2);
    context.ellipse(px + host.face.eyeRightX * pw, py + host.face.eyeY * ph, ew / 2, eh / 2, 0, 0, Math.PI * 2);
    context.fill();
  }
  if (frame.speaking && viseme.openness > 0.08) {
    const box = mouthBox(host.face, viseme);
    const cx = px + box.x * pw;
    const cy = py + box.y * ph;
    const gradient = context.createRadialGradient(cx, cy, 1, cx, cy, (box.w * pw) / 2);
    gradient.addColorStop(0, 'rgba(42, 12, 16, 0.92)');
    gradient.addColorStop(0.7, 'rgba(90, 32, 40, 0.8)');
    gradient.addColorStop(1, 'rgba(90, 32, 40, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(cx, cy, (box.w * pw) / 2, Math.max(3, (box.h * ph) / 2), 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  if (frame.showAiLabel !== false) {
    context.fillStyle = 'rgba(12, 10, 8, 0.62)';
    roundRect(context, width - 168, 24, 136, 28, 14);
    context.fill();
    context.fillStyle = '#fff8f2';
    context.font = '15px sans-serif';
    context.fillText('AI数字人直播', width - 156, 43);
  }

  context.fillStyle = '#ff4b38';
  roundRect(context, 36, 28, frame.speaking ? 92 : 74, 28, 14);
  context.fill();
  context.fillStyle = '#fff8f2';
  context.font = '16px sans-serif';
  context.fillText(frame.speaking ? '口播中' : '待命', 48, 47);
  context.font = '26px sans-serif';
  context.fillText(frame.host || host.name, 36, 86);

  context.fillStyle = 'rgba(20, 15, 12, 0.72)';
  roundRect(context, 28, height - 118, width - 56, 86, 16);
  context.fill();
  context.fillStyle = '#f0c27a';
  context.font = '18px sans-serif';
  context.fillText(frame.product || '直播间', 48, height - 82);
  context.fillStyle = '#f6efe4';
  context.font = '22px sans-serif';
  wrapText(context, frame.caption || '准备开口', 48, height - 50, width - 96, 28);
}

function image(src: string): HTMLImageElement | null {
  let picture = images.get(src);
  if (!picture) {
    picture = new Image();
    picture.src = src;
    images.set(src, picture);
  }
  return picture.complete && picture.naturalWidth > 0 ? picture : null;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const chars = [...text];
  let line = '';
  let cursor = y;
  let lines = 0;
  for (const char of chars) {
    const next = line + char;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, cursor);
      line = char;
      cursor += lineHeight;
      lines += 1;
      if (lines === 2) break;
    } else {
      line = next;
    }
  }
  if (lines < 2 && line) context.fillText(line, x, cursor);
}
