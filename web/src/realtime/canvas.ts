export interface BroadcastFrame {
  host: string;
  caption: string;
  product: string;
  speaking: boolean;
}

export function startBroadcast(canvas: HTMLCanvasElement, read: () => BroadcastFrame) {
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') return null;
  canvas.width = 960;
  canvas.height = 540;
  let timer = 0;
  let frame = 0;
  const draw = () => {
    frame += 1;
    paint(context, read(), frame);
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

function paint(context: CanvasRenderingContext2D, frame: BroadcastFrame, tick: number) {
  const { width, height } = context.canvas;
  context.fillStyle = '#140f0c';
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width / 2, 210, 40, width / 2, 210, 320);
  glow.addColorStop(0, 'rgba(255, 75, 56, 0.35)');
  glow.addColorStop(1, 'rgba(255, 75, 56, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#ff4b38';
  roundRect(context, 36, 28, frame.speaking ? 92 : 74, 28, 14);
  context.fill();
  context.fillStyle = '#fff8f2';
  context.font = '16px sans-serif';
  context.fillText(frame.speaking ? '口播中' : '待命', 48, 47);

  context.fillStyle = '#f6efe4';
  context.font = '28px sans-serif';
  context.fillText(frame.host || '主播', 36, 92);

  const mouth = frame.speaking ? 8 + (tick % 12) : 3;
  context.fillStyle = '#ffd8c2';
  context.beginPath();
  context.ellipse(width / 2, 230, 78, 90, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#1a120e';
  context.beginPath();
  context.ellipse(width / 2, 188, 84, 64, 0, Math.PI, Math.PI * 2);
  context.fill();
  context.fillStyle = '#241811';
  context.beginPath();
  context.ellipse(width / 2 - 28, 228, 7, 9, 0, 0, Math.PI * 2);
  context.ellipse(width / 2 + 28, 228, 7, 9, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#7a3040';
  context.beginPath();
  context.ellipse(width / 2, 268, 16, mouth, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#ff4b38';
  context.beginPath();
  context.moveTo(width / 2 - 120, 330);
  context.quadraticCurveTo(width / 2, 280, width / 2 + 120, 330);
  context.lineTo(width / 2 + 150, height - 92);
  context.lineTo(width / 2 - 150, height - 92);
  context.closePath();
  context.fill();

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
