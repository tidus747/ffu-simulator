import { describe, expect, it } from 'vitest';
import { CX, CY, CZ, OPP, Q, W } from '@core/solver/lattice/d3q19';

describe('D3Q19', () => {
  it('los pesos suman 1', () => {
    expect(W.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
  });

  it('el primer momento de los pesos es nulo y el segundo es isótropo (cs² = 1/3)', () => {
    const c = [CX, CY, CZ];
    for (let a = 0; a < 3; a++) {
      let first = 0;
      for (let q = 0; q < Q; q++) first += W[q]! * c[a]![q]!;
      expect(first).toBeCloseTo(0, 14);
      for (let b = 0; b < 3; b++) {
        let second = 0;
        for (let q = 0; q < Q; q++) second += W[q]! * c[a]![q]! * c[b]![q]!;
        expect(second).toBeCloseTo(a === b ? 1 / 3 : 0, 14);
      }
    }
  });

  it('OPP apunta a la dirección opuesta', () => {
    for (let q = 0; q < Q; q++) {
      const o = OPP[q]!;
      expect([CX[o], CY[o], CZ[o]]).toEqual([-CX[q]! || 0, -CY[q]! || 0, -CZ[q]! || 0]);
      expect(OPP[o]).toBe(q);
    }
  });

  it('proyectado sobre xy reproduce exactamente los pesos de D2Q9 (modo 2D)', () => {
    const projected = new Map<string, number>();
    for (let q = 0; q < Q; q++) {
      const key = `${CX[q]},${CY[q]}`;
      projected.set(key, (projected.get(key) ?? 0) + W[q]!);
    }
    expect(projected.size).toBe(9);
    for (const [key, w] of projected) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      const expected = cx === 0 && cy === 0 ? 4 / 9 : cx !== 0 && cy !== 0 ? 1 / 36 : 1 / 9;
      expect(w).toBeCloseTo(expected, 14);
    }
  });
});
