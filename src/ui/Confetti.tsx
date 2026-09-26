import { useEffect, useRef } from 'react';

const COLORS = ['#ffd23f', '#ff7a59', '#56b8ff', '#97e85a', '#c79bff', '#ffffff'];

/** A short burst of confetti over the whole screen. Pure canvas, no library. */
export function Confetti({ pieces = 140, duration = 3200 }: { pieces?: number; duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const W = () => canvas.width;
    const H = () => canvas.height;
    const parts = Array.from({ length: pieces }, () => ({
      x: W() / 2 + (Math.random() - 0.5) * W() * 0.3,
      y: H() * 0.35,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 16 - 6) * dpr,
      size: (5 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
    }));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W(), H());
      ctx.globalAlpha = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
      for (const p of parts) {
        p.vy += 0.45 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (t < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pieces, duration]);
  return <canvas ref={ref} className="confetti" aria-hidden />;
}
