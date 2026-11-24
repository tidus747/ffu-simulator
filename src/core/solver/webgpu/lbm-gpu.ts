/**
 * Solver LBM D3Q19 en WebGPU. Mismo algoritmo y misma disposición de memoria que LbmCpu
 * (f[q * n + celda], repartido en grupos de buffers según los límites del dispositivo).
 */

import { Q } from '../lattice/d3q19';
import { cellCount } from '../lattice/grid';
import type { LbmConfig } from '../lbm-config';
import { planDistributions, type DistributionPlan } from './layout';
import { PARAMS_BYTES, buildInitKernel, buildStepKernel } from './wgsl';

export interface LbmGpuOptions {
  workgroupSize?: number;
}

export class LbmGpu {
  readonly n: number;
  readonly plan: DistributionPlan;
  readonly workgroupSize: number;
  readonly dispatch: readonly [number, number];
  /** Buffers de poblaciones: [conjunto A, conjunto B], cada uno con un buffer por grupo. */
  readonly state: readonly [GPUBuffer[], GPUBuffer[]];
  readonly maskBuffer: GPUBuffer;
  /** Índice del conjunto que contiene el estado más reciente. */
  current: 0 | 1 = 0;
  /** Pasos ejecutados desde la última inicialización. */
  steps = 0;

  private readonly params: GPUBuffer;
  private stepPipeline!: GPUComputePipeline;
  private initPipeline!: GPUComputePipeline;
  private stepBind!: [GPUBindGroup, GPUBindGroup];
  private initBind!: GPUBindGroup;

  private constructor(
    readonly device: GPUDevice,
    readonly config: LbmConfig,
    opts: LbmGpuOptions,
  ) {
    this.n = cellCount(config);
    this.workgroupSize = opts.workgroupSize ?? 128;
    this.plan = planDistributions(this.n, device.limits);
    const groups = Math.ceil(this.n / this.workgroupSize);
    const maxPerDim = device.limits.maxComputeWorkgroupsPerDimension;
    const dx = Math.min(groups, maxPerDim);
    this.dispatch = [dx, Math.ceil(groups / dx)];

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const makeSet = (name: string) =>
      this.plan.groupBytes.map((size, g) =>
        device.createBuffer({ label: `f${name}${g}`, size, usage }),
      );
    this.state = [makeSet('A'), makeSet('B')];
    this.maskBuffer = device.createBuffer({
      label: 'mask',
      size: this.n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.params = device.createBuffer({
      label: 'params',
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  static async create(
    device: GPUDevice,
    config: LbmConfig,
    mask: Uint32Array,
    opts: LbmGpuOptions = {},
  ): Promise<LbmGpu> {
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    let sim: LbmGpu | undefined;
    let ctorError: unknown;
    try {
      sim = new LbmGpu(device, config, opts);
    } catch (err) {
      ctorError = err;
    }
    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    if (ctorError || validation || oom || !sim) {
      sim?.destroy();
      if (ctorError) throw ctorError;
      if (oom) throw new Error(`Sin memoria en la GPU (${oom.message})`);
      throw new Error(`Error reservando buffers: ${validation?.message}`);
    }
    try {
      await sim.buildPipelines();
      device.queue.writeBuffer(sim.maskBuffer, 0, mask);
      sim.writeParams();
    } catch (err) {
      sim.destroy();
      throw err;
    }
    return sim;
  }

  private async buildPipelines(): Promise<void> {
    const { groups } = this.plan;
    const stepCode = buildStepKernel({
      groups,
      workgroupSize: this.workgroupSize,
      sponge: Boolean(this.config.sponge),
    });
    const initCode = buildInitKernel(groups, this.workgroupSize);
    [this.stepPipeline, this.initPipeline] = await Promise.all([
      compilePipeline(this.device, 'lbm-step', stepCode),
      compilePipeline(this.device, 'lbm-init', initCode),
    ]);

    const G = groups.length;
    const stepEntries = (from: GPUBuffer[], to: GPUBuffer[]): GPUBindGroupEntry[] => [
      { binding: 0, resource: { buffer: this.params } },
      { binding: 1, resource: { buffer: this.maskBuffer } },
      ...from.map((buffer, g) => ({ binding: 2 + g, resource: { buffer } })),
      ...to.map((buffer, g) => ({ binding: 2 + G + g, resource: { buffer } })),
    ];
    const layout = this.stepPipeline.getBindGroupLayout(0);
    const [a, b] = this.state;
    this.stepBind = [
      this.device.createBindGroup({ label: 'step A→B', layout, entries: stepEntries(a, b) }),
      this.device.createBindGroup({ label: 'step B→A', layout, entries: stepEntries(b, a) }),
    ];
    this.initBind = this.device.createBindGroup({
      label: 'init A',
      layout: this.initPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        ...a.map((buffer, g) => ({ binding: 1 + g, resource: { buffer } })),
      ],
    });
  }

  private writeParams(init?: { rho: number; u: readonly [number, number, number] }): void {
    const { nx, ny, nz, omega, force, sponge } = this.config;
    const data = new ArrayBuffer(PARAMS_BYTES);
    const v = new DataView(data);
    v.setUint32(0, nx, true);
    v.setUint32(4, ny, true);
    v.setUint32(8, nz, true);
    v.setUint32(12, this.n, true);
    v.setFloat32(16, omega, true);
    v.setFloat32(20, force[0], true);
    v.setFloat32(24, force[1], true);
    v.setFloat32(28, force[2], true);
    v.setUint32(32, this.dispatch[0], true);
    v.setUint32(36, sponge?.startX ?? nx, true);
    v.setFloat32(40, sponge?.strength ?? 0, true);
    v.setFloat32(44, sponge?.ux ?? 0, true);
    v.setFloat32(48, init?.u[0] ?? 0, true);
    v.setFloat32(52, init?.u[1] ?? 0, true);
    v.setFloat32(56, init?.u[2] ?? 0, true);
    v.setFloat32(60, init?.rho ?? 1, true);
    this.device.queue.writeBuffer(this.params, 0, data);
  }

  /** Equilibrio uniforme en todas las celdas, calculado en la GPU (sin copias desde CPU). */
  initUniform(rho: number, u: readonly [number, number, number]): void {
    this.writeParams({ rho, u });
    const enc = this.device.createCommandEncoder({ label: 'init' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.initPipeline);
    pass.setBindGroup(0, this.initBind);
    pass.dispatchWorkgroups(this.dispatch[0], this.dispatch[1]);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.current = 0;
    this.steps = 0;
  }

  /** Sube un estado completo f[q * n + celda] (para validar contra la CPU). */
  upload(f: Float32Array): void {
    if (f.length !== Q * this.n) throw new Error('Tamaño de f incorrecto');
    this.plan.groups.forEach((group, g) => {
      group.forEach((q, local) => {
        this.device.queue.writeBuffer(this.state[0][g]!, local * this.n * 4, f, q * this.n, this.n);
      });
    });
    this.current = 0;
    this.steps = 0;
  }

  /** Añade `count` pasos a un encoder, en un único compute pass. */
  encodeSteps(encoder: GPUCommandEncoder, count: number): void {
    if (count <= 0) return;
    const pass = encoder.beginComputePass({ label: 'lbm-steps' });
    pass.setPipeline(this.stepPipeline);
    for (let i = 0; i < count; i++) {
      pass.setBindGroup(0, this.stepBind[this.current]);
      pass.dispatchWorkgroups(this.dispatch[0], this.dispatch[1]);
      this.current = this.current === 0 ? 1 : 0;
    }
    pass.end();
    this.steps += count;
  }

  /** Ejecuta `count` pasos y espera a que la GPU termine. */
  async run(count: number, batch = 500): Promise<void> {
    for (let done = 0; done < count; done += batch) {
      const enc = this.device.createCommandEncoder({ label: 'lbm-run' });
      this.encodeSteps(enc, Math.min(batch, count - done));
      this.device.queue.submit([enc.finish()]);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  /** Lee el estado actual completo como f[q * n + celda]. Solo para mallas pequeñas. */
  async read(): Promise<Float32Array> {
    const out = new Float32Array(Q * this.n);
    const enc = this.device.createCommandEncoder({ label: 'readback' });
    const staging = this.state[this.current].map((buf, g) => {
      const s = this.device.createBuffer({
        size: this.plan.groupBytes[g]!,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      enc.copyBufferToBuffer(buf, 0, s, 0, this.plan.groupBytes[g]!);
      return s;
    });
    this.device.queue.submit([enc.finish()]);
    await Promise.all(staging.map((s) => s.mapAsync(GPUMapMode.READ)));
    staging.forEach((s, g) => {
      const data = new Float32Array(s.getMappedRange());
      this.plan.groups[g]!.forEach((q, local) => {
        out.set(data.subarray(local * this.n, (local + 1) * this.n), q * this.n);
      });
      s.unmap();
      s.destroy();
    });
    return out;
  }

  destroy(): void {
    for (const set of this.state) for (const b of set) b.destroy();
    this.maskBuffer.destroy();
    this.params.destroy();
  }
}

export async function compilePipeline(
  device: GPUDevice,
  label: string,
  code: string,
): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({ label, code });
  await assertCompiled(module, label);
  return device.createComputePipelineAsync({
    label,
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
}

export async function assertCompiled(module: GPUShaderModule, label: string): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) {
    const text = errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n');
    throw new Error(`Error compilando ${label}:\n${text}`);
  }
}
