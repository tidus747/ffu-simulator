import type { BenchReport, BenchRun } from '@core/bench/gpu-bench';
import { fmt, fmtBytes } from './format';

function RunRow({ run }: { run: BenchRun }) {
  return (
    <tr>
      <td>{run.label}</td>
      <td>
        {run.grid.nx} × {run.grid.ny} × {run.grid.nz}
      </td>
      <td className="num">{fmt(run.cells / 1e6, 1)} M</td>
      <td className="num">{run.memoryMiB ? fmtBytes(run.memoryMiB) : '—'}</td>
      {run.error ? (
        <td colSpan={3} className="error">
          {run.error}
        </td>
      ) : (
        <>
          <td className="num">{fmt(run.mlups ?? 0, 0)}</td>
          <td className="num">{fmt(run.stepsPerSecond ?? 0, 0)}</td>
          <td className="num">{fmt(run.physicalSecondsPerSecond ?? 0, 2)} s</td>
        </>
      )}
    </tr>
  );
}

export function BenchResults({ report }: { report: BenchReport }) {
  const { validation: v, verdict } = report;
  return (
    <section className="bench">
      <div className={`verdict ${verdict.viable ? 'ok' : 'ko'}`}>
        <strong>{verdict.viable ? 'Viable con WebGPU' : 'No alcanza el objetivo'}</strong>
        <span>{verdict.reason}</span>
      </div>

      <h3>Validación del kernel</h3>
      <ul className="checks">
        <li className={v.poiseuillePass ? 'ok' : 'ko'}>
          Poiseuille: error máximo {fmt(v.poiseuilleMaxError * 100, 3)} % (límite 1 %)
        </li>
        <li className={v.cpuGpuPass ? 'ok' : 'ko'}>
          CPU ↔ GPU tras 200 pasos: diferencia máxima {v.cpuGpuMaxDiff.toExponential(2)} (límite
          1e-4)
        </li>
      </ul>

      <h3>Rendimiento (máquina de 3 × 2 × 1,6 m)</h3>
      <table>
        <thead>
          <tr>
            <th>Celda</th>
            <th>Malla</th>
            <th className="num">Celdas</th>
            <th className="num">Memoria</th>
            <th className="num">M celdas/s</th>
            <th className="num">Pasos/s</th>
            <th className="num">Tiempo físico/s</th>
          </tr>
        </thead>
        <tbody>
          {report.runs.map((r) => (
            <RunRow key={r.label} run={r} />
          ))}
        </tbody>
      </table>
      <p className="muted">
        Tiempo físico simulado por segundo real, con dt calculado para 1 m/s de velocidad máxima.
        Grupo de trabajo: {report.runs[0]?.workgroupSize ?? '—'} (barrido:{' '}
        {report.workgroupSweep
          .map((r) => `${r.workgroupSize} → ${r.mlups ? fmt(r.mlups, 0) : 'error'}`)
          .join(', ')}
        ).
      </p>
    </section>
  );
}
