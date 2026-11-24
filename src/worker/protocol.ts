/** Mensajes entre la interfaz y el hilo de simulación. */

import type { BenchReport } from '../core/bench/gpu-bench';
import type { GpuInfo } from '../core/gpu/device';
import type { SliceField } from '../core/solver/webgpu/slice-renderer';

export interface DemoSettings {
  running: boolean;
  field: SliceField;
  /** Pasos por fotograma; null = automático (~60 fps). */
  stepsPerFrame: number | null;
}

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'resize'; width: number; height: number }
  | { type: 'demo'; settings: Partial<DemoSettings> }
  | { type: 'demo-reset' }
  | { type: 'bench' };

export interface DemoInfo {
  nx: number;
  ny: number;
  nz: number;
  reynolds: number;
}

export interface DemoStats {
  fps: number;
  stepsPerFrame: number;
  stepsPerSecond: number;
  mlups: number;
  totalSteps: number;
}

export type FromWorker =
  | { type: 'ready'; gpu: GpuInfo; demo: DemoInfo }
  | { type: 'error'; message: string }
  | { type: 'log'; message: string }
  | { type: 'stats'; stats: DemoStats }
  | { type: 'bench-progress'; message: string }
  | { type: 'bench-done'; report: BenchReport }
  | { type: 'bench-failed'; message: string };
