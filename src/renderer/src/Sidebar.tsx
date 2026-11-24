import { useState } from 'react';
import type { GpuInfo } from '@core/gpu/device';
import type { SliceField } from '@core/solver/webgpu/slice-renderer';
import type { DemoSettings } from '@worker/protocol';
import type { BenchState } from './useSimulation';
import { fmtBytes } from './format';

interface Props {
  gpu?: GpuInfo;
  bench: BenchState;
  updateDemo(settings: Partial<DemoSettings>): void;
  resetDemo(): void;
  runBench(): void;
}

export function Sidebar({ gpu, bench, updateDemo, resetDemo, runBench }: Props) {
  const [running, setRunning] = useState(true);
  const [field, setField] = useState<SliceField>('vorticity');
  const [auto, setAuto] = useState(true);
  const [steps, setSteps] = useState(20);
  const busy = bench.status === 'running';

  return (
    <aside className="sidebar">
      <section className="card">
        <h2>GPU</h2>
        {gpu ? (
          <dl className="kv">
            <dt>Adaptador</dt>
            <dd>{gpu.description || `${gpu.vendor} ${gpu.architecture}`}</dd>
            <dt>Fabricante</dt>
            <dd>{gpu.vendor || '—'}</dd>
            <dt>Buffer máx.</dt>
            <dd>{fmtBytes((gpu.limits['maxBufferSize'] ?? 0) / 2 ** 20)}</dd>
            <dt>Enlace máx.</dt>
            <dd>{fmtBytes((gpu.limits['maxStorageBufferBindingSize'] ?? 0) / 2 ** 20)}</dd>
            <dt>Buffers/etapa</dt>
            <dd>{gpu.limits['maxStorageBuffersPerShaderStage'] ?? '—'}</dd>
            <dt>FP16</dt>
            <dd>{gpu.features.includes('shader-f16') ? 'sí' : 'no'}</dd>
          </dl>
        ) : (
          <p className="muted">Inicializando WebGPU…</p>
        )}
      </section>

      <section className="card">
        <h2>Demo</h2>
        <div className="row">
          <button
            onClick={() => {
              setRunning(!running);
              updateDemo({ running: !running });
            }}
            disabled={busy}
          >
            {running ? 'Pausar' : 'Reanudar'}
          </button>
          <button onClick={resetDemo} disabled={busy}>
            Reiniciar
          </button>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Campo">
          {(['vorticity', 'speed'] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={field === f}
              className={field === f ? 'active' : ''}
              onClick={() => {
                setField(f);
                updateDemo({ field: f });
              }}
            >
              {f === 'vorticity' ? 'Vorticidad' : 'Velocidad'}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              updateDemo({ stepsPerFrame: e.target.checked ? null : steps });
            }}
          />
          Pasos por fotograma automáticos
        </label>
        {!auto && (
          <label className="slider">
            <span>{steps} pasos/fotograma</span>
            <input
              type="range"
              min={1}
              max={200}
              value={steps}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSteps(v);
                updateDemo({ stepsPerFrame: v });
              }}
            />
          </label>
        )}
      </section>

      <section className="card">
        <h2>Prueba de viabilidad</h2>
        <p className="muted">
          Valida el kernel en GPU y mide el rendimiento con las mallas de una máquina de 3 × 2 × 1,6
          m. Tarda unos minutos y pausa la demo.
        </p>
        <button className="primary" onClick={runBench} disabled={busy || !gpu}>
          {busy ? 'Ejecutando…' : 'Ejecutar prueba de GPU'}
        </button>
        {bench.status === 'running' && <p className="progress">{bench.message}</p>}
        {bench.status === 'failed' && <p className="error">{bench.message}</p>}
      </section>
    </aside>
  );
}
