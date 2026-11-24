/**
 * Solver LBM D3Q19 de referencia en CPU.
 *
 * Mismo algoritmo que el kernel WebGPU (esquema pull fusionado, rebote a mitad de enlace,
 * BGK con forzado de Guo) y misma disposición de memoria: f[q * n + celda].
 * Es lento: sirve para tests y para validar la GPU en mallas pequeñas.
 */

import { CX, CY, CZ, OPP, Q, W, equilibrium } from '../lattice/d3q19';
import { SOLID_BIT, cellCount } from '../lattice/grid';
import { spongeFactor, type LbmConfig } from '../lbm-config';

export interface Macro {
  rho: number;
  ux: number;
  uy: number;
  uz: number;
}

export class LbmCpu {
  readonly n: number;
  /** Poblaciones post-colisión del último paso. */
  f: Float32Array;
  private next: Float32Array;

  constructor(
    readonly config: LbmConfig,
    readonly mask: Uint32Array,
  ) {
    this.n = cellCount(config);
    if (mask.length !== this.n) throw new Error('La máscara no coincide con la malla');
    this.f = new Float32Array(Q * this.n);
    this.next = new Float32Array(Q * this.n);
  }

  /** Inicializa todas las celdas fluidas en equilibrio. `perturb` permite romper simetrías. */
  initEquilibrium(
    rho: number,
    u: readonly [number, number, number],
    perturb?: (x: number, y: number, z: number) => readonly [number, number, number],
  ): void {
    const { nx, ny, nz } = this.config;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          const d = perturb ? perturb(x, y, z) : ([0, 0, 0] as const);
          for (let q = 0; q < Q; q++) {
            this.f[q * this.n + idx] = equilibrium(q, rho, u[0] + d[0], u[1] + d[1], u[2] + d[2]);
          }
        }
      }
    }
  }

  step(): void {
    const { nx, ny, nz, omega, force, sponge } = this.config;
    const [fx, fy, fz] = force;
    const n = this.n;
    const src = this.f;
    const dst = this.next;
    const fk = 1 - 0.5 * omega;
    const fi = new Float64Array(Q);

    for (let z = 0; z < nz; z++) {
      const zm = z === 0 ? nz - 1 : z - 1;
      const zp = z === nz - 1 ? 0 : z + 1;
      for (let y = 0; y < ny; y++) {
        const ym = y === 0 ? ny - 1 : y - 1;
        const yp = y === ny - 1 ? 0 : y + 1;
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          const m = this.mask[idx]!;
          if ((m & SOLID_BIT) !== 0) continue;
          const xm = x === 0 ? nx - 1 : x - 1;
          const xp = x === nx - 1 ? 0 : x + 1;

          let rho = 0;
          let jx = 0;
          let jy = 0;
          let jz = 0;
          for (let q = 0; q < Q; q++) {
            let v: number;
            if (q !== 0 && (m & (1 << q)) !== 0) {
              v = src[OPP[q]! * n + idx]!;
            } else {
              const sx = CX[q] === 1 ? xm : CX[q] === -1 ? xp : x;
              const sy = CY[q] === 1 ? ym : CY[q] === -1 ? yp : y;
              const sz = CZ[q] === 1 ? zm : CZ[q] === -1 ? zp : z;
              v = src[q * n + sx + nx * (sy + ny * sz)]!;
            }
            fi[q] = v;
            rho += v;
            jx += CX[q]! * v;
            jy += CY[q]! * v;
            jz += CZ[q]! * v;
          }

          const inv = 1 / rho;
          const ux = (jx + 0.5 * fx) * inv;
          const uy = (jy + 0.5 * fy) * inv;
          const uz = (jz + 0.5 * fz) * inv;
          const usq = ux * ux + uy * uy + uz * uz;
          const uf = ux * fx + uy * fy + uz * fz;
          const sp = sponge ? spongeFactor(sponge, x, nx) : 0;

          for (let q = 0; q < Q; q++) {
            const cu = CX[q]! * ux + CY[q]! * uy + CZ[q]! * uz;
            const cf = CX[q]! * fx + CY[q]! * fy + CZ[q]! * fz;
            const feq = W[q]! * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * usq);
            const s = W[q]! * (3 * (cf - uf) + 9 * cu * cf);
            let post = fi[q]! - omega * (fi[q]! - feq) + fk * s;
            if (sp > 0) post += sp * (equilibrium(q, 1, sponge!.ux, 0, 0) - post);
            dst[q * n + idx] = post;
          }
        }
      }
    }

    this.next = src;
    this.f = dst;
  }

  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.step();
  }

  macro(idx: number): Macro {
    return macroscopic(this.f, this.n, idx, this.config.force);
  }

  totalMass(): number {
    let sum = 0;
    for (let idx = 0; idx < this.n; idx++) {
      if ((this.mask[idx]! & SOLID_BIT) !== 0) continue;
      for (let q = 0; q < Q; q++) sum += this.f[q * this.n + idx]!;
    }
    return sum;
  }
}

/**
 * Densidad y velocidad a partir de f post-colisión (el estado que se guarda entre pasos).
 * Con el forzado de Guo, el momento post-colisión es j_pre + F, y la velocidad física de
 * ese paso es (j_pre + F/2)/rho, así que aquí se resta medio paso de la fuerza.
 */
export function macroscopic(
  f: Float32Array,
  n: number,
  idx: number,
  force: readonly [number, number, number],
): Macro {
  let rho = 0;
  let jx = 0;
  let jy = 0;
  let jz = 0;
  for (let q = 0; q < Q; q++) {
    const v = f[q * n + idx]!;
    rho += v;
    jx += CX[q]! * v;
    jy += CY[q]! * v;
    jz += CZ[q]! * v;
  }
  return {
    rho,
    ux: (jx - 0.5 * force[0]) / rho,
    uy: (jy - 0.5 * force[1]) / rho,
    uz: (jz - 0.5 * force[2]) / rho,
  };
}
