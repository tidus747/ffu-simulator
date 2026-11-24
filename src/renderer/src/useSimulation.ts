import { useCallback, useEffect, useRef, useState } from 'react';
import SimWorker from '@worker/sim.worker?worker';
import type { BenchReport } from '@core/bench/gpu-bench';
import type { GpuInfo } from '@core/gpu/device';
import type { DemoInfo, DemoSettings, DemoStats, FromWorker, ToWorker } from '@worker/protocol';

export type BenchState =
  | { status: 'idle' }
  | { status: 'running'; message: string }
  | { status: 'done'; report: BenchReport }
  | { status: 'failed'; message: string };

export interface SimulationState {
  gpu?: GpuInfo;
  demo?: DemoInfo;
  stats?: DemoStats;
  error?: string;
  bench: BenchState;
}

export function useSimulation(benchOnLoad: boolean) {
  const workerRef = useRef<Worker | null>(null);
  const transferred = useRef(false);
  const [state, setState] = useState<SimulationState>({ bench: { status: 'idle' } });

  // El worker se crea la primera vez que se necesita: los efectos de los hijos (el visor, que
  // transfiere el canvas) se ejecutan antes que los de este hook, así que no puede crearse aquí
  // en un useEffect.
  const getWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new SimWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          setState((s) => ({ ...s, gpu: msg.gpu, demo: msg.demo }));
          if (benchOnLoad) {
            setState((s) => ({ ...s, bench: { status: 'running', message: 'Iniciando…' } }));
            worker.postMessage({ type: 'bench' } satisfies ToWorker);
          }
          break;
        case 'stats':
          setState((s) => ({ ...s, stats: msg.stats }));
          break;
        case 'log':
          console.log(`[worker] ${msg.message}`);
          break;
        case 'error':
          console.error(msg.message);
          setState((s) => ({ ...s, error: msg.message }));
          break;
        case 'bench-progress':
          console.log(msg.message);
          setState((s) => ({ ...s, bench: { status: 'running', message: msg.message } }));
          break;
        case 'bench-done':
          setState((s) => ({ ...s, bench: { status: 'done', report: msg.report } }));
          void window.ffu.reportBench(msg.report);
          break;
        case 'bench-failed':
          console.error(msg.message);
          setState((s) => ({ ...s, bench: { status: 'failed', message: msg.message } }));
          if (benchOnLoad) void window.ffu.reportBench({ error: msg.message });
          break;
      }
    };
    worker.onerror = (event) => {
      setState((s) => ({ ...s, error: event.message || 'Error en el hilo de simulación' }));
      if (benchOnLoad) void window.ffu.reportBench({ error: event.message });
    };
    return worker;
  }, [benchOnLoad]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const send = useCallback(
    (msg: ToWorker, transfer: Transferable[] = []) => getWorker().postMessage(msg, transfer),
    [getWorker],
  );

  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (transferred.current) return;
      transferred.current = true;
      const offscreen = canvas.transferControlToOffscreen();
      send({ type: 'init', canvas: offscreen }, [offscreen]);
    },
    [send],
  );

  const resize = useCallback(
    (width: number, height: number) => send({ type: 'resize', width, height }),
    [send],
  );

  const updateDemo = useCallback(
    (settings: Partial<DemoSettings>) => send({ type: 'demo', settings }),
    [send],
  );

  const resetDemo = useCallback(() => send({ type: 'demo-reset' }), [send]);

  const runBench = useCallback(() => {
    setState((s) => ({ ...s, bench: { status: 'running', message: 'Iniciando…' } }));
    send({ type: 'bench' });
  }, [send]);

  return { state, attachCanvas, resize, updateDemo, resetDemo, runBench };
}
