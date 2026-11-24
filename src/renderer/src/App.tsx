import { BenchResults } from './BenchResults';
import { Sidebar } from './Sidebar';
import { useSimulation } from './useSimulation';
import { Viewport } from './Viewport';

const benchOnLoad = new URLSearchParams(window.location.search).get('bench') === '1';

export function App() {
  const sim = useSimulation(benchOnLoad);
  const { state } = sim;
  const v = window.ffu?.versions;

  return (
    <div className="app">
      <header className="topbar">
        <h1>FFU Simulator</h1>
        <span className="badge">Fase 0</span>
        {v && (
          <span className="versions">
            Electron {v.electron} · Chromium {v.chrome}
          </span>
        )}
      </header>
      <div className="layout">
        <Sidebar
          gpu={state.gpu}
          bench={state.bench}
          updateDemo={sim.updateDemo}
          resetDemo={sim.resetDemo}
          runBench={sim.runBench}
        />
        <main className="main">
          {state.error && <div className="banner error">{state.error}</div>}
          <Viewport
            demo={state.demo}
            stats={state.stats}
            attachCanvas={sim.attachCanvas}
            resize={sim.resize}
          />
          {state.bench.status === 'done' && <BenchResults report={state.bench.report} />}
        </main>
      </div>
    </div>
  );
}
