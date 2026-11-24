import { describe, expect, it } from 'vitest';
import { CX, CY, CZ, Q } from '@core/solver/lattice/d3q19';
import { SOLID_BIT, buildPullMask, cellIndex } from '@core/solver/lattice/grid';

describe('máscara pull', () => {
  const g = { nx: 5, ny: 4, nz: 3 };

  it('marca las celdas sólidas con el bit 31', () => {
    const solid = new Uint8Array(60);
    solid[cellIndex(g, 2, 1, 1)] = 1;
    const mask = buildPullMask(g, solid);
    expect(mask[cellIndex(g, 2, 1, 1)]).toBe(SOLID_BIT);
  });

  it('cada vecino fluido de un sólido tiene activo el bit de la dirección que apunta hacia fuera de él', () => {
    const solid = new Uint8Array(60);
    const s = { x: 2, y: 1, z: 1 };
    solid[cellIndex(g, s.x, s.y, s.z)] = 1;
    const mask = buildPullMask(g, solid);
    for (let q = 1; q < Q; q++) {
      // La celda en s + c_q tira de la población q desde s: debe rebotar.
      const idx = cellIndex(g, s.x + CX[q]!, s.y + CY[q]!, s.z + CZ[q]!);
      expect((mask[idx]! >>> q) & 1).toBe(1);
    }
  });

  it('los bordes son periódicos', () => {
    const solid = new Uint8Array(60);
    solid[cellIndex(g, 0, 0, 0)] = 1;
    const mask = buildPullMask(g, solid);
    // La celda (nx-1, 0, 0) tira de q=2 (c = -x) desde (0, 0, 0) por periodicidad.
    expect((mask[cellIndex(g, g.nx - 1, 0, 0)]! >>> 2) & 1).toBe(1);
  });

  it('rechaza una máscara de tamaño incorrecto', () => {
    expect(() => buildPullMask(g, new Uint8Array(10))).toThrow();
  });
});
