import { Q } from '../lattice/d3q19';

export interface DeviceLimits {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxStorageBuffersPerShaderStage: number;
}

/**
 * Reparto de las 19 poblaciones en buffers. Cada buffer guarda varias direcciones
 * consecutivas (f[local * n + celda]) y no puede superar los límites del dispositivo.
 */
export interface DistributionPlan {
  /** Direcciones q de cada buffer. */
  groups: number[][];
  /** Tamaño en bytes de cada buffer. */
  groupBytes: number[];
  /** Memoria total de poblaciones (dos copias, ping-pong) + máscara. */
  totalBytes: number;
}

export function planDistributions(n: number, limits: DeviceLimits): DistributionPlan {
  const bytesPerDirection = n * 4;
  const maxBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  const directionsPerBuffer = Math.min(Q, Math.floor(maxBytes / bytesPerDirection));
  if (directionsPerBuffer < 1) {
    throw new Error(
      `Una sola dirección ocupa ${mb(bytesPerDirection)} y el límite por buffer es ${mb(maxBytes)}`,
    );
  }
  const groupCount = Math.ceil(Q / directionsPerBuffer);
  // Paso + máscara: 2 buffers de poblaciones por grupo + 1 de máscara.
  if (2 * groupCount + 1 > limits.maxStorageBuffersPerShaderStage) {
    throw new Error(
      `Harían falta ${2 * groupCount + 1} buffers de almacenamiento y el máximo es ` +
        `${limits.maxStorageBuffersPerShaderStage}`,
    );
  }
  const perGroup = Math.ceil(Q / groupCount);
  const groups: number[][] = [];
  for (let start = 0; start < Q; start += perGroup) {
    groups.push(Array.from({ length: Math.min(perGroup, Q - start) }, (_, i) => start + i));
  }
  const groupBytes = groups.map((g) => g.length * bytesPerDirection);
  const totalBytes = 2 * groupBytes.reduce((a, b) => a + b, 0) + n * 4;
  return { groups, groupBytes, totalBytes };
}

function mb(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(0)} MiB`;
}
