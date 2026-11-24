import { describe, expect, it } from 'vitest';
import {
  AIR,
  deriveLatticeUnits,
  velocityToLattice,
  velocityToPhysical,
} from '@core/units/lattice-units';

describe('unidades de red', () => {
  it('celda de 1 cm y 1 m/s máximo → dt = 1 ms', () => {
    const u = deriveLatticeUnits({ dx: 0.01, uMaxPhys: 1 });
    expect(u.dt).toBeCloseTo(1e-3, 12);
    expect(u.nuLattice).toBeCloseTo((AIR.nu * 1e-3) / 1e-4, 12);
  });

  it('con la viscosidad real del aire tau queda pegado a 0,5 (por eso hace falta LES)', () => {
    const u = deriveLatticeUnits({ dx: 0.01, uMaxPhys: 1 });
    expect(u.tau).toBeGreaterThan(0.5);
    expect(u.tau).toBeLessThan(0.501);
  });

  it('la conversión de velocidades es reversible', () => {
    const units = deriveLatticeUnits({ dx: 0.02, uMaxPhys: 0.8, uMaxLattice: 0.08 });
    expect(velocityToLattice(0.8, units)).toBeCloseTo(0.08, 12);
    expect(velocityToPhysical(velocityToLattice(0.45, units), units)).toBeCloseTo(0.45, 12);
  });

  it('rechaza parámetros no positivos', () => {
    expect(() => deriveLatticeUnits({ dx: 0, uMaxPhys: 1 })).toThrow();
  });
});
