import { useEffect, useRef } from 'react';
import type { DemoInfo, DemoStats } from '@worker/protocol';
import { fmt } from './format';

interface Props {
  demo?: DemoInfo;
  stats?: DemoStats;
  attachCanvas(canvas: HTMLCanvasElement): void;
  resize(width: number, height: number): void;
}

export function Viewport({ demo, stats, attachCanvas, resize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    attachCanvas(canvas);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      const box = entry.contentRect;
      resize(Math.max(1, Math.round(box.width * dpr)), Math.max(1, Math.round(box.height * dpr)));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [attachCanvas, resize]);

  const aspect = demo ? `${demo.nx} / ${demo.ny}` : '3 / 1';

  return (
    <section className="viewport">
      <div className="viewport-frame">
        <canvas ref={canvasRef} className="viewport-canvas" style={{ aspectRatio: aspect }} />
        {stats && (
          <div className="viewport-hud">
            <span>{fmt(stats.fps, 0)} fps</span>
            <span>{fmt(stats.stepsPerFrame, 0)} pasos/fotograma</span>
            <span>{fmt(stats.mlups, 0)} M celdas/s</span>
            <span>paso {fmt(stats.totalSteps, 0)}</span>
          </div>
        )}
      </div>
      {demo && (
        <p className="viewport-caption">
          Demo: canal 3D de {demo.nx} × {demo.ny} × {demo.nz} celdas con un cilindro (Re ≈{' '}
          {demo.reynolds}), corte central. Comprueba la cadena worker → WebGPU → render; no es una
          simulación validada de la máquina.
        </p>
      )}
    </section>
  );
}
