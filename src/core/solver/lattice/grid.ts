import { CX, CY, CZ, Q } from './d3q19';

export interface GridSize {
  nx: number;
  ny: number;
  nz: number;
}

export function cellCount({ nx, ny, nz }: GridSize): number {
  return nx * ny * nz;
}

/** Índice lineal: x es el eje más rápido. */
export function cellIndex(g: GridSize, x: number, y: number, z: number): number {
  return x + g.nx * (y + g.ny * z);
}

/** Bit 31 de la máscara: la propia celda es sólida. */
export const SOLID_BIT = 0x80000000;

/**
 * Máscara por celda para el esquema *pull*.
 * Bit 31: celda sólida. Bit q (1..18): la celda de la que se "tira" de la población q,
 * es decir (x - cx, y - cy, z - cz), es sólida, así que hay rebote (*bounce-back*).
 * Los bordes del dominio son periódicos; las paredes se definen con celdas sólidas.
 */
export function buildPullMask(g: GridSize, solid: Uint8Array): Uint32Array {
  const { nx, ny, nz } = g;
  const n = nx * ny * nz;
  if (solid.length !== n) {
    throw new Error(`La máscara de sólidos tiene ${solid.length} celdas y la malla ${n}`);
  }
  const mask = new Uint32Array(n);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        if (solid[idx]) {
          mask[idx] = SOLID_BIT;
          continue;
        }
        let m = 0;
        for (let q = 1; q < Q; q++) {
          const sx = (x - CX[q]! + nx) % nx;
          const sy = (y - CY[q]! + ny) % ny;
          const sz = (z - CZ[q]! + nz) % nz;
          if (solid[sx + nx * (sy + ny * sz)]) m |= 1 << q;
        }
        mask[idx] = m >>> 0;
      }
    }
  }
  return mask;
}
