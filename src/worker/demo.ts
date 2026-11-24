/**
 * Demo de la Fase 0: canal 3D con un cilindro (calle de vórtices de von Kármán).
 * Sirve para comprobar la cadena completa worker → WebGPU (cálculo) → OffscreenCanvas
 * (render), no es una simulación validada de la máquina.
 */

import { buildPullMask, cellIndex } from '../core/solver/lattice/grid';
import type { LbmConfig } from '../core/solver/lbm-config';
import { LbmGpu } from '../core/solver/webgpu/lbm-gpu';
import type { DemoInfo } from './protocol';

const NX = 384;
const NY = 128;
const NZ = 16;
const RADIUS = 12;
const U0 = 0.06;
const TAU = 0.53;

export const DEMO_INFO: DemoInfo = {
  nx: NX,
  ny: NY,
  nz: NZ,
  reynolds: Math.round((U0 * 2 * RADIUS) / ((TAU - 0.5) / 3)),
};

export const DEMO_SCALES = { speed: 1 / (2 * U0), vorticity: 12 };

export async function createDemo(device: GPUDevice): Promise<LbmGpu> {
  const grid = { nx: NX, ny: NY, nz: NZ };
  const solid = new Uint8Array(NX * NY * NZ);
  // Cilindro ligeramente descentrado para romper la simetría y que empiece a desprender.
  const cx = 96;
  const cy = NY / 2 + 2;
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const wall = y === 0 || y === NY - 1;
        const cyl = (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS;
        if (wall || cyl) solid[cellIndex(grid, x, y, z)] = 1;
      }
    }
  }
  // Periódico en x: la zona de amortiguación final devuelve un flujo uniforme a la entrada.
  const config: LbmConfig = {
    ...grid,
    omega: 1 / TAU,
    force: [0, 0, 0],
    sponge: { startX: NX - 72, strength: 0.1, ux: U0 },
  };
  const sim = await LbmGpu.create(device, config, buildPullMask(grid, solid));
  sim.initUniform(1, [U0, 0, 0]);
  return sim;
}
