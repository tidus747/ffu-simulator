/**
 * Prueba de viabilidad de la Fase 0: valida el kernel D3Q19 en GPU y mide su rendimiento
 * con las mallas de una máquina de 3 × 2 × 1,6 m (largo × alto × ancho).
 */

import type { GpuContext, GpuInfo } from '../gpu/device';
import { poiseuilleCase, poiseuilleError } from '../solver/cases/poiseuille';
import { LbmCpu, macroscopic } from '../solver/cpu/lbm-cpu';
import { buildPullMask, cellIndex, type GridSize } from '../solver/lattice/grid';
import type { LbmConfig } from '../solver/lbm-config';
import { planDistributions } from '../solver/webgpu/layout';
import { LbmGpu } from '../solver/webgpu/lbm-gpu';
import { deriveLatticeUnits } from '../units/lattice-units';

export interface BenchRun {
  label: string;
  dx: number;
  grid: GridSize;
  cells: number;
  memoryMiB: number;
  buffers: number;
  workgroupSize: number;
  stepsPerSecond?: number;
  /** Millones de actualizaciones de celda por segundo. */
  mlups?: number;
  /** Segundos de tiempo físico simulados por segundo real (dt para 1 m/s máx. y u_red = 0,1). */
  physicalSecondsPerSecond?: number;
  error?: string;
}

export interface BenchValidation {
  poiseuilleMaxError: number;
  poiseuillePass: boolean;
  cpuGpuMaxDiff: number;
  cpuGpuPass: boolean;
}

export interface BenchReport {
  timestamp: string;
  gpu: GpuInfo;
  validation: BenchValidation;
  workgroupSweep: BenchRun[];
  runs: BenchRun[];
  verdict: { viable: boolean; reason: string };
}

const MACHINE = { length: 3.0, height: 2.0, width: 1.6 };
const RESOLUTIONS = [
  { label: '2 cm', dx: 0.02 },
  { label: '1,5 cm', dx: 0.015 },
  { label: '1 cm', dx: 0.01 },
  { label: '7,5 mm', dx: 0.0075 },
];
/** Criterio de la Fase 0: la malla de 1 cm debe caber y superar este rendimiento. */
export const VIABILITY_MLUPS = 500;

export async function runGpuBench(
  gpu: GpuContext,
  progress: (message: string) => void,
): Promise<BenchReport> {
  const { device } = gpu;

  progress('Validando: Poiseuille en GPU…');
  const pc = poiseuilleCase();
  const pSim = await LbmGpu.create(device, pc.config, buildPullMask(pc.config, pc.solid));
  pSim.initUniform(1, [0, 0, 0]);
  await pSim.run(pc.steadySteps);
  const pf = await pSim.read();
  pSim.destroy();
  const poiseuilleMaxError = poiseuilleError(
    pc,
    (y) => macroscopic(pf, pSim.n, cellIndex(pc.config, 0, y, 0), pc.config.force).ux,
  );

  progress('Validando: equivalencia CPU ↔ GPU…');
  const cpuGpuMaxDiff = await compareCpuGpu(device);

  const validation: BenchValidation = {
    poiseuilleMaxError,
    poiseuillePass: poiseuilleMaxError < 0.01,
    cpuGpuMaxDiff,
    cpuGpuPass: cpuGpuMaxDiff < 1e-4,
  };

  const grids = RESOLUTIONS.map((r) => ({
    ...r,
    grid: {
      nx: Math.round(MACHINE.length / r.dx),
      ny: Math.round(MACHINE.height / r.dx),
      nz: Math.round(MACHINE.width / r.dx),
    },
  }));

  const workgroupSweep: BenchRun[] = [];
  const ref = grids.find((g) => g.dx === 0.01) ?? grids[0]!;
  for (const wg of [64, 128, 256]) {
    if (wg > device.limits.maxComputeInvocationsPerWorkgroup) continue;
    progress(`Ajustando tamaño de grupo de trabajo (${wg}) con la malla de ${ref.label}…`);
    workgroupSweep.push(await measure(device, ref.label, ref.dx, ref.grid, wg));
  }
  const bestWg =
    [...workgroupSweep].filter((r) => r.mlups).sort((a, b) => b.mlups! - a.mlups!)[0]
      ?.workgroupSize ?? 128;

  const runs: BenchRun[] = [];
  for (const g of grids) {
    progress(`Midiendo malla de ${g.label} (${(cellsOf(g.grid) / 1e6).toFixed(1)} M celdas)…`);
    runs.push(await measure(device, g.label, g.dx, g.grid, bestWg));
  }

  const oneCm = runs.find((r) => r.dx === 0.01);
  const viable = Boolean(
    validation.poiseuillePass &&
    validation.cpuGpuPass &&
    oneCm?.mlups &&
    oneCm.mlups >= VIABILITY_MLUPS,
  );
  const reason =
    !validation.poiseuillePass || !validation.cpuGpuPass
      ? 'La validación del kernel no ha pasado'
      : !oneCm?.mlups
        ? `La malla de 1 cm no se pudo ejecutar: ${oneCm?.error ?? 'desconocido'}`
        : viable
          ? `La malla de 1 cm da ${oneCm.mlups.toFixed(0)} M celdas/s (objetivo ≥ ${VIABILITY_MLUPS})`
          : `La malla de 1 cm da ${oneCm.mlups.toFixed(0)} M celdas/s, por debajo de ${VIABILITY_MLUPS}`;

  return {
    timestamp: new Date().toISOString(),
    gpu: gpu.info,
    validation,
    workgroupSweep,
    runs,
    verdict: { viable, reason },
  };
}

function cellsOf(g: GridSize): number {
  return g.nx * g.ny * g.nz;
}

/** Caja cerrada (paredes en las 6 caras) con un bloque interior, como una máquina simplificada. */
function machineSolid(g: GridSize): Uint8Array {
  const { nx, ny, nz } = g;
  const solid = new Uint8Array(nx * ny * nz);
  const bx0 = Math.floor(nx * 0.4);
  const bx1 = Math.floor(nx * 0.55);
  const by1 = Math.floor(ny * 0.35);
  const bz0 = Math.floor(nz * 0.25);
  const bz1 = Math.floor(nz * 0.75);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const wall = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
        const block = x >= bx0 && x < bx1 && y < by1 && z >= bz0 && z < bz1;
        if (wall || block) solid[x + nx * (y + ny * z)] = 1;
      }
    }
  }
  return solid;
}

async function measure(
  device: GPUDevice,
  label: string,
  dx: number,
  grid: GridSize,
  workgroupSize: number,
): Promise<BenchRun> {
  const cells = cellsOf(grid);
  const base: BenchRun = {
    label,
    dx,
    grid,
    cells,
    memoryMiB: 0,
    buffers: 0,
    workgroupSize,
  };
  let sim: LbmGpu | undefined;
  try {
    const plan = planDistributions(cells, device.limits);
    base.memoryMiB = plan.totalBytes / 2 ** 20;
    base.buffers = plan.groups.length;
    const config: LbmConfig = { ...grid, omega: 1 / 0.52, force: [1e-6, 0, 0] };
    sim = await LbmGpu.create(device, config, buildPullMask(grid, machineSolid(grid)), {
      workgroupSize,
    });
    sim.initUniform(1, [0.02, 0, 0]);
    await sim.run(10);

    // Calibración: ~2 s de medida.
    let steps = 20;
    let elapsed = await timed(sim, steps);
    if (elapsed < 2000) {
      steps = Math.max(steps, Math.round((steps * 2000) / Math.max(elapsed, 1)));
      elapsed = await timed(sim, steps);
    }
    const stepsPerSecond = (steps * 1000) / elapsed;
    const { dt } = deriveLatticeUnits({ dx, uMaxPhys: 1, uMaxLattice: 0.1 });
    return {
      ...base,
      stepsPerSecond,
      mlups: (stepsPerSecond * cells) / 1e6,
      physicalSecondsPerSecond: stepsPerSecond * dt,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sim?.destroy();
  }
}

async function timed(sim: LbmGpu, steps: number): Promise<number> {
  const t0 = performance.now();
  await sim.run(steps, 200);
  return performance.now() - t0;
}

/** Mismo caso en CPU y GPU durante 200 pasos; devuelve la máxima diferencia absoluta en f. */
async function compareCpuGpu(device: GPUDevice): Promise<number> {
  const g = { nx: 12, ny: 10, nz: 6 };
  const solid = new Uint8Array(g.nx * g.ny * g.nz);
  for (let z = 0; z < g.nz; z++) {
    for (let x = 0; x < g.nx; x++) {
      solid[cellIndex(g, x, 0, z)] = 1;
      solid[cellIndex(g, x, g.ny - 1, z)] = 1;
    }
    solid[cellIndex(g, 5, 4, z)] = 1;
    solid[cellIndex(g, 5, 5, z)] = 1;
  }
  const config: LbmConfig = {
    ...g,
    omega: 1.6,
    force: [2e-5, 1e-6, 0],
    sponge: { startX: 8, strength: 0.05, ux: 0.03 },
  };
  const mask = buildPullMask(g, solid);
  const cpu = new LbmCpu(config, mask);
  cpu.initEquilibrium(1, [0.03, 0, 0], (x, y, z) => [0, 0.002 * Math.sin(x + 2 * y + 3 * z), 0]);

  const gpu = await LbmGpu.create(device, config, mask);
  gpu.upload(cpu.f);
  cpu.run(200);
  await gpu.run(200);
  const gf = await gpu.read();
  gpu.destroy();

  let maxDiff = 0;
  for (let idx = 0; idx < cpu.n; idx++) {
    if (solid[idx]) continue;
    for (let q = 0; q < 19; q++) {
      const i = q * cpu.n + idx;
      maxDiff = Math.max(maxDiff, Math.abs(cpu.f[i]! - gf[i]!));
    }
  }
  return maxDiff;
}
