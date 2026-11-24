/**
 * Acceso a la GPU vía WebGPU (en Windows se traduce a Direct3D 12 y corre de forma nativa).
 * Pide los límites máximos que ofrece el adaptador: los de por defecto (128 MiB por buffer)
 * se quedan cortos para mallas 3D.
 */

export interface GpuInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallback: boolean;
  features: string[];
  limits: Record<string, number>;
}

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  info: GpuInfo;
}

const LIMITS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxStorageBuffersPerShaderStage',
  'maxStorageBuffersInFragmentStage',
  'maxComputeWorkgroupsPerDimension',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
] as const;

const OPTIONAL_FEATURES = ['shader-f16', 'timestamp-query', 'subgroups'] as const;

export async function acquireGpu(onLost?: (reason: string) => void): Promise<GpuContext> {
  const gpu = navigator.gpu;
  if (!gpu) throw new Error('WebGPU no está disponible en este entorno');

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No se encontró ningún adaptador WebGPU');

  const adapterLimits = adapter.limits as unknown as Record<string, number | undefined>;
  const requiredLimits: Record<string, number> = {};
  for (const name of LIMITS) {
    const value = adapterLimits[name];
    if (typeof value === 'number') requiredLimits[name] = value;
  }
  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));

  const device = await adapter.requestDevice({
    requiredLimits,
    requiredFeatures: requiredFeatures as unknown as GPUFeatureName[],
  });
  void device.lost.then((lost) => onLost?.(`${lost.reason}: ${lost.message}`));

  const ai = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  return {
    adapter,
    device,
    info: {
      vendor: ai.vendor,
      architecture: ai.architecture,
      device: ai.device,
      description: ai.description,
      isFallback: Boolean(ai.isFallbackAdapter),
      features: [...adapter.features].sort(),
      limits: requiredLimits,
    },
  };
}
