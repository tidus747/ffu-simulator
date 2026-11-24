/// <reference lib="webworker" />
/**
 * Hilo de simulación: posee el dispositivo WebGPU, calcula y dibuja en un OffscreenCanvas.
 * La interfaz solo recibe mensajes pequeños (estadísticas, progreso, informes).
 */

import { runGpuBench } from '../core/bench/gpu-bench';
import { acquireGpu, type GpuContext } from '../core/gpu/device';
import type { LbmGpu } from '../core/solver/webgpu/lbm-gpu';
import { SliceRenderer } from '../core/solver/webgpu/slice-renderer';
import { DEMO_INFO, DEMO_SCALES, createDemo } from './demo';
import type { DemoSettings, FromWorker, ToWorker } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let gpu: GpuContext | undefined;
let canvas: OffscreenCanvas | undefined;
let context: GPUCanvasContext | undefined;
let format: GPUTextureFormat = 'bgra8unorm';
let sim: LbmGpu | undefined;
let renderer: SliceRenderer | undefined;
let benchRunning = false;
let loopActive = false;
let needsRender = true;

const settings: DemoSettings = { running: true, field: 'vorticity', stepsPerFrame: null };
let autoSteps = 10;

const stats = { frames: 0, steps: 0, since: 0 };

function post(msg: FromWorker): void {
  ctx.postMessage(msg);
}

function log(message: string): void {
  post({ type: 'log', message });
}

function fail(err: unknown): void {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}

async function startDemo(): Promise<void> {
  if (!gpu) return;
  sim = await createDemo(gpu.device);
  renderer = await SliceRenderer.create(sim, format);
  needsRender = true;
}

function stopDemo(): void {
  renderer?.destroy();
  sim?.destroy();
  renderer = undefined;
  sim = undefined;
}

async function frame(): Promise<void> {
  if (!gpu || !context || !sim || !renderer || benchRunning) {
    loopActive = false;
    return;
  }
  const t0 = performance.now();
  const steps = settings.running ? (settings.stepsPerFrame ?? autoSteps) : 0;
  if (steps > 0 || needsRender) {
    const enc = gpu.device.createCommandEncoder({ label: 'frame' });
    sim.encodeSteps(enc, steps);
    renderer.encode(enc, context.getCurrentTexture().createView(), {
      field: settings.field,
      zSlice: sim.config.nz / 2,
      scale: DEMO_SCALES[settings.field],
    });
    gpu.device.queue.submit([enc.finish()]);
    await gpu.device.queue.onSubmittedWorkDone();
    needsRender = false;
  }
  const frameMs = performance.now() - t0;

  // Ajuste automático para quedarse en ~14 ms de GPU por fotograma.
  if (settings.stepsPerFrame === null && steps > 0) {
    if (frameMs > 18) autoSteps = Math.max(1, Math.floor(autoSteps * 0.85));
    else if (frameMs < 11) autoSteps = Math.min(400, autoSteps + Math.max(1, autoSteps >> 3));
  }

  stats.frames++;
  stats.steps += steps;
  const now = performance.now();
  if (now - stats.since >= 1000) {
    const secs = (now - stats.since) / 1000;
    const stepsPerSecond = stats.steps / secs;
    post({
      type: 'stats',
      stats: {
        fps: stats.frames / secs,
        stepsPerFrame: steps,
        stepsPerSecond,
        mlups: (stepsPerSecond * sim.n) / 1e6,
        totalSteps: sim.steps,
      },
    });
    stats.frames = 0;
    stats.steps = 0;
    stats.since = now;
  }
  requestAnimationFrame(() => void frame().catch(fail));
}

function ensureLoop(): void {
  if (loopActive) return;
  loopActive = true;
  stats.since = performance.now();
  requestAnimationFrame(() => void frame().catch(fail));
}

async function runBench(): Promise<void> {
  if (!gpu || benchRunning) return;
  benchRunning = true;
  try {
    // Se libera la demo para que la prueba disponga de toda la memoria de la GPU.
    stopDemo();
    const report = await runGpuBench(gpu, (message) => post({ type: 'bench-progress', message }));
    post({ type: 'bench-done', report });
  } catch (err) {
    post({ type: 'bench-failed', message: err instanceof Error ? err.message : String(err) });
  } finally {
    benchRunning = false;
    await startDemo();
    ensureLoop();
  }
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  void (async () => {
    switch (msg.type) {
      case 'init': {
        canvas = msg.canvas;
        log('Pidiendo adaptador y dispositivo WebGPU…');
        gpu = await acquireGpu((reason) =>
          post({ type: 'error', message: `GPU perdida: ${reason}` }),
        );
        log(`Dispositivo listo: ${gpu.info.description || gpu.info.vendor}`);
        const canvasContext = canvas.getContext('webgpu');
        if (!canvasContext) throw new Error('No se pudo crear el contexto WebGPU del canvas');
        context = canvasContext;
        format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device: gpu.device, format, alphaMode: 'opaque' });
        log('Canvas configurado; creando la demo…');
        await startDemo();
        log('Demo creada');
        post({ type: 'ready', gpu: gpu.info, demo: DEMO_INFO });
        ensureLoop();
        break;
      }
      case 'resize': {
        if (canvas && msg.width > 0 && msg.height > 0) {
          canvas.width = msg.width;
          canvas.height = msg.height;
          needsRender = true;
        }
        break;
      }
      case 'demo': {
        Object.assign(settings, msg.settings);
        needsRender = true;
        break;
      }
      case 'demo-reset': {
        if (sim) {
          sim.initUniform(1, [sim.config.sponge?.ux ?? 0, 0, 0]);
          needsRender = true;
        }
        break;
      }
      case 'bench': {
        await runBench();
        break;
      }
    }
  })().catch(fail);
};
