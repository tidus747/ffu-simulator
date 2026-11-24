import type { GridSize } from './lattice/grid';

/** Zona de amortiguación: relaja hacia un flujo uniforme cerca del final del dominio en x. */
export interface SpongeConfig {
  /** Primera columna x de la zona. */
  startX: number;
  /** Intensidad máxima de relajación por paso (0–1), alcanzada en x = nx - 1. */
  strength: number;
  /** Velocidad uniforme objetivo en x (unidades de red). */
  ux: number;
}

export interface LbmConfig extends GridSize {
  /** Frecuencia de relajación BGK: omega = 1 / tau. */
  omega: number;
  /** Fuerza volumétrica uniforme (unidades de red). */
  force: readonly [number, number, number];
  sponge?: SpongeConfig;
}

export function spongeFactor(s: SpongeConfig, x: number, nx: number): number {
  if (x < s.startX) return 0;
  const t = (x - s.startX) / Math.max(1, nx - 1 - s.startX);
  return s.strength * t * t;
}
