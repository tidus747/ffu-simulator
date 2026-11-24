/**
 * Conjunto de velocidades D3Q19.
 *
 * Con una sola celda de espesor y periodicidad en z, las direcciones con componente z
 * se proyectan sobre el plano xy y sus pesos suman exactamente los de D2Q9. Por eso el
 * modo 2D usa el mismo motor (ver tests/core/d3q19.test.ts).
 */

export const Q = 19;

// prettier-ignore
export const CX: readonly number[] = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 0, 0, 1, -1, 1, -1, 0, 0];
// prettier-ignore
export const CY: readonly number[] = [0, 0, 0, 1, -1, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 1, -1];
// prettier-ignore
export const CZ: readonly number[] = [0, 0, 0, 0, 0, 1, -1, 0, 0, 1, -1, 1, -1, 0, 0, -1, 1, -1, 1];

const W0 = 1 / 3;
const W1 = 1 / 18;
const W2 = 1 / 36;

// prettier-ignore
export const W: readonly number[] = [
  W0,
  W1, W1, W1, W1, W1, W1,
  W2, W2, W2, W2, W2, W2, W2, W2, W2, W2, W2, W2,
];

/** Índice de la dirección opuesta (c[OPP[q]] = -c[q]). */
// prettier-ignore
export const OPP: readonly number[] = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17];

/** Distribución de equilibrio de segundo orden. */
export function equilibrium(q: number, rho: number, ux: number, uy: number, uz: number): number {
  const cu = CX[q]! * ux + CY[q]! * uy + CZ[q]! * uz;
  const usq = ux * ux + uy * uy + uz * uz;
  return W[q]! * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * usq);
}
