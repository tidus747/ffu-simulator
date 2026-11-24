import { assertCompiled, type LbmGpu } from './lbm-gpu';
import { RENDER_PARAMS_BYTES, buildSliceShader } from './wgsl';

export type SliceField = 'speed' | 'vorticity';

export interface SliceView {
  field: SliceField;
  /** Corte z = zSlice. */
  zSlice: number;
  /** Escala de color: velocidad × scale ∈ [0, 1]; vorticidad: 0,5 + ω × scale. */
  scale: number;
}

/** Dibuja un corte de la simulación leyendo directamente los buffers de la GPU. */
export class SliceRenderer {
  private readonly params: GPUBuffer;
  private bind!: [GPUBindGroup, GPUBindGroup];
  private pipeline!: GPURenderPipeline;

  private constructor(
    private readonly sim: LbmGpu,
    private readonly format: GPUTextureFormat,
  ) {
    this.params = sim.device.createBuffer({
      label: 'render-params',
      size: RENDER_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  static async create(sim: LbmGpu, format: GPUTextureFormat): Promise<SliceRenderer> {
    const r = new SliceRenderer(sim, format);
    await r.build();
    return r;
  }

  private async build(): Promise<void> {
    const { device } = this.sim;
    const module = device.createShaderModule({
      label: 'slice',
      code: buildSliceShader(this.sim.plan.groups),
    });
    await assertCompiled(module, 'slice');
    this.pipeline = await device.createRenderPipelineAsync({
      label: 'slice',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    const layout = this.pipeline.getBindGroupLayout(0);
    const entries = (set: GPUBuffer[]): GPUBindGroupEntry[] => [
      { binding: 0, resource: { buffer: this.params } },
      { binding: 1, resource: { buffer: this.sim.maskBuffer } },
      ...set.map((buffer, g) => ({ binding: 2 + g, resource: { buffer } })),
    ];
    this.bind = [
      device.createBindGroup({ label: 'slice A', layout, entries: entries(this.sim.state[0]) }),
      device.createBindGroup({ label: 'slice B', layout, entries: entries(this.sim.state[1]) }),
    ];
  }

  encode(encoder: GPUCommandEncoder, target: GPUTextureView, view: SliceView): void {
    const { nx, ny, nz, force } = this.sim.config;
    const data = new ArrayBuffer(RENDER_PARAMS_BYTES);
    const v = new DataView(data);
    v.setUint32(0, nx, true);
    v.setUint32(4, ny, true);
    v.setUint32(8, nz, true);
    v.setUint32(12, this.sim.n, true);
    v.setUint32(16, Math.min(Math.max(0, Math.round(view.zSlice)), nz - 1), true);
    v.setUint32(20, view.field === 'speed' ? 0 : 1, true);
    v.setFloat32(24, view.scale, true);
    v.setFloat32(28, force[0], true);
    v.setFloat32(32, force[1], true);
    v.setFloat32(36, force[2], true);
    this.sim.device.queue.writeBuffer(this.params, 0, data);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind[this.sim.current]);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    this.params.destroy();
  }
}
