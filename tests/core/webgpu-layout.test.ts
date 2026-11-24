import { describe, expect, it } from 'vitest';
import { Q } from '@core/solver/lattice/d3q19';
import { planDistributions } from '@core/solver/webgpu/layout';
import { buildInitKernel, buildSliceShader, buildStepKernel } from '@core/solver/webgpu/wgsl';

const GiB = 2 ** 30;
const MiB = 2 ** 20;

describe('reparto de poblaciones en buffers', () => {
  it('con límites holgados usa un solo buffer por copia', () => {
    const plan = planDistributions(9_600_000, {
      maxBufferSize: 2 * GiB,
      maxStorageBufferBindingSize: 2 * GiB - 4,
      maxStorageBuffersPerShaderStage: 16,
    });
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toHaveLength(Q);
    expect(plan.totalBytes).toBe(2 * Q * 9_600_000 * 4 + 9_600_000 * 4);
  });

  it('con los límites por defecto de WebGPU reparte en varios buffers sin pasarse', () => {
    const n = 2_000_000; // 8 MB por dirección
    const limits = {
      maxBufferSize: 256 * MiB,
      maxStorageBufferBindingSize: 128 * MiB,
      maxStorageBuffersPerShaderStage: 8,
    };
    const plan = planDistributions(n, limits);
    expect(plan.groups.flat().sort((a, b) => a - b)).toEqual(
      Array.from({ length: Q }, (_, i) => i),
    );
    for (const bytes of plan.groupBytes) expect(bytes).toBeLessThanOrEqual(128 * MiB);
    expect(2 * plan.groups.length + 1).toBeLessThanOrEqual(8);
  });

  it('rechaza mallas que no caben', () => {
    expect(() =>
      planDistributions(100_000_000, {
        maxBufferSize: 256 * MiB,
        maxStorageBufferBindingSize: 128 * MiB,
        maxStorageBuffersPerShaderStage: 8,
      }),
    ).toThrow();
  });
});

describe('generación de WGSL', () => {
  const groups = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14, 15, 16, 17, 18],
  ];

  it('el paso declara un buffer de lectura y otro de escritura por grupo', () => {
    const code = buildStepKernel({ groups, workgroupSize: 128, sponge: false });
    expect(code).toContain('var<storage, read> src1');
    expect(code).toContain('var<storage, read_write> dst1');
    expect(code).toContain('@workgroup_size(128)');
    expect(code).not.toContain('spongeFactor');
    // q = 12 es la tercera dirección del segundo grupo.
    expect(code).toContain('dst1[2u * n + idx] = post;');
  });

  it('la zona de amortiguación solo se genera si se pide', () => {
    expect(buildStepKernel({ groups, workgroupSize: 64, sponge: true })).toContain(
      'fn spongeFactor',
    );
  });

  it('init y render referencian todos los grupos', () => {
    expect(buildInitKernel(groups, 64)).toContain('out1');
    expect(buildSliceShader(groups)).toContain('src1');
  });
});
