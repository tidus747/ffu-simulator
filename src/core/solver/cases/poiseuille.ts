/**
 * Caso de validación: flujo de Poiseuille entre dos placas, impulsado por una fuerza uniforme.
 * Periódico en x y z; paredes sólidas en y = 0 e y = ny - 1. Con rebote a mitad de enlace,
 * las paredes quedan en y = 0,5 e y = ny - 1,5, y la solución analítica es una parábola.
 */

import type { LbmConfig } from '../lbm-config';

export interface PoiseuilleOptions {
  /** Altura del canal en celdas fluidas. */
  height?: number;
  nx?: number;
  nz?: number;
  tau?: number;
  /** Velocidad máxima objetivo en el centro (unidades de red). */
  uMax?: number;
}

export interface PoiseuilleCase {
  config: LbmConfig;
  solid: Uint8Array;
  uMax: number;
  /** Pasos recomendados para alcanzar el régimen estacionario con error < 0,1 %. */
  steadySteps: number;
  analytic(y: number): number;
}

export function poiseuilleCase(opts: PoiseuilleOptions = {}): PoiseuilleCase {
  const { height = 16, nx = 4, nz = 4, tau = 0.8, uMax = 0.05 } = opts;
  const ny = height + 2;
  const nu = (tau - 0.5) / 3;
  const fx = (8 * nu * uMax) / (height * height);
  const solid = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      solid[x + nx * (0 + ny * z)] = 1;
      solid[x + nx * (ny - 1 + ny * z)] = 1;
    }
  }
  // Modo más lento: tiempo de caída H²/(π²·nu); ~8 constantes de tiempo.
  const steadySteps = Math.ceil((8 * height * height) / (Math.PI * Math.PI * nu));
  return {
    config: { nx, ny, nz, omega: 1 / tau, force: [fx, 0, 0] },
    solid,
    uMax,
    steadySteps,
    analytic: (y) => (fx / (2 * nu)) * (y - 0.5) * (ny - 1.5 - y),
  };
}

/** Error máximo relativo a uMax sobre las filas fluidas, dado el perfil ux(y) en x = z = 0. */
export function poiseuilleError(c: PoiseuilleCase, uxAt: (y: number) => number): number {
  let maxErr = 0;
  for (let y = 1; y < c.config.ny - 1; y++) {
    maxErr = Math.max(maxErr, Math.abs(uxAt(y) - c.analytic(y)) / c.uMax);
  }
  return maxErr;
}
