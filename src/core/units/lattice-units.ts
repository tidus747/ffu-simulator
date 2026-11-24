/**
 * Conversión entre unidades físicas (SI) y unidades de red del LBM.
 *
 * El paso de tiempo se elige para que la velocidad física máxima esperada corresponda a
 * `uMaxLattice` en unidades de red (régimen de bajo Mach, típicamente 0,05–0,1).
 */

export const AIR = {
  /** Viscosidad cinemática a ~20 °C [m²/s]. */
  nu: 1.5e-5,
  /** Densidad [kg/m³]. */
  rho: 1.2,
  /** Calor específico [J/(kg·K)]. */
  cp: 1005,
  /** Conductividad térmica [W/(m·K)]. */
  k: 0.026,
} as const;

export interface LatticeUnitsInput {
  /** Tamaño de celda [m]. */
  dx: number;
  /** Velocidad física máxima esperada [m/s]. */
  uMaxPhys: number;
  /** Velocidad de red que le corresponde (adimensional). */
  uMaxLattice?: number;
  /** Viscosidad cinemática física [m²/s]. */
  nuPhys?: number;
}

export interface LatticeUnits {
  dx: number;
  /** Paso de tiempo [s]. */
  dt: number;
  /** Viscosidad en unidades de red. */
  nuLattice: number;
  /** Tiempo de relajación BGK: tau = 3·nu + 0,5. */
  tau: number;
}

export function deriveLatticeUnits(input: LatticeUnitsInput): LatticeUnits {
  const { dx, uMaxPhys, uMaxLattice = 0.1, nuPhys = AIR.nu } = input;
  if (!(dx > 0) || !(uMaxPhys > 0) || !(uMaxLattice > 0)) {
    throw new Error('dx, uMaxPhys y uMaxLattice deben ser positivos');
  }
  const dt = (uMaxLattice * dx) / uMaxPhys;
  const nuLattice = (nuPhys * dt) / (dx * dx);
  return { dx, dt, nuLattice, tau: 3 * nuLattice + 0.5 };
}

export function velocityToLattice(u: number, units: LatticeUnits): number {
  return (u * units.dt) / units.dx;
}

export function velocityToPhysical(u: number, units: LatticeUnits): number {
  return (u * units.dx) / units.dt;
}
