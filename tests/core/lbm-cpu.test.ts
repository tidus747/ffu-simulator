import { describe, expect, it } from 'vitest';
import { LbmCpu } from '@core/solver/cpu/lbm-cpu';
import { buildPullMask, cellIndex } from '@core/solver/lattice/grid';
import { poiseuilleCase, poiseuilleError } from '@core/solver/cases/poiseuille';

describe('LBM CPU de referencia', () => {
  it('reproduce el perfil de Poiseuille con menos de un 1 % de error', () => {
    const c = poiseuilleCase();
    const sim = new LbmCpu(c.config, buildPullMask(c.config, c.solid));
    sim.initEquilibrium(1, [0, 0, 0]);
    sim.run(c.steadySteps);
    const err = poiseuilleError(c, (y) => sim.macro(cellIndex(c.config, 0, y, 0)).ux);
    expect(err).toBeLessThan(0.01);
  });

  it('conserva la masa en un dominio cerrado con obstáculo', () => {
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
    const sim = new LbmCpu({ ...g, omega: 1.6, force: [2e-5, 0, 0] }, buildPullMask(g, solid));
    sim.initEquilibrium(1, [0.03, 0, 0]);
    const m0 = sim.totalMass();
    sim.run(300);
    expect(Math.abs(sim.totalMass() - m0) / m0).toBeLessThan(1e-5);
  });
});
