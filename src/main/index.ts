import { app, BrowserWindow, ipcMain } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `electron . --bench`: ejecuta la prueba de GPU sin mostrar ventana, la guarda y sale. */
const benchMode = process.argv.includes('--bench');
const BENCH_TIMEOUT_MS = 20 * 60 * 1000;

/** Depuración: FFU_SCREENSHOT=ruta.png captura la ventana tras FFU_SCREENSHOT_DELAY ms y sale. */
const screenshotPath = process.env['FFU_SCREENSHOT'];
const screenshotDelay = Number(process.env['FFU_SCREENSHOT_DELAY'] ?? 8000);
/** Vuelca la consola de la interfaz y los eventos de carga a stdout. */
const debugLog = benchMode || Boolean(screenshotPath) || Boolean(process.env['FFU_DEBUG']);

// En Windows Chromium ignora `powerPreference` de WebGPU (crbug.com/369219127) y usa la GPU
// del proceso de GPU, que en portátiles con gráfica integrada + dedicada es la integrada.
// Este switch hace que el proceso de GPU, y con él WebGPU, use la de alto rendimiento.
app.commandLine.appendSwitch('force_high_performance_gpu');

function attachDebugLog(win: BrowserWindow): void {
  const log = (msg: string) => process.stdout.write(`${msg}\n`);
  const wc = win.webContents;
  wc.on('console-message', (event) => log(`[renderer] ${event.message}`));
  wc.on('did-finish-load', () => log('[main] interfaz cargada'));
  wc.on('did-fail-load', (_e, code, desc, url) =>
    log(`[main] fallo de carga ${code} ${desc} ${url}`),
  );
  wc.on('preload-error', (_e, path, error) => log(`[main] error en preload ${path}: ${error}`));
  wc.on('render-process-gone', (_e, details) => log(`[main] renderer caído: ${details.reason}`));
}

function captureAndQuit(win: BrowserWindow, file: string): void {
  setTimeout(() => {
    void win.webContents.capturePage().then((image) => {
      writeFileSync(file, image.toPNG());
      process.stdout.write(`[main] captura guardada en ${file}\n`);
      app.quit();
    });
  }, screenshotDelay);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'FFU Simulator',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (debugLog) attachDebugLog(win);
  if (!benchMode) {
    win.once('ready-to-show', () => {
      win.show();
      if (screenshotPath) captureAndQuit(win, screenshotPath);
    });
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(benchMode ? `${devUrl}?bench=1` : devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: benchMode ? { bench: '1' } : {},
    });
  }
  return win;
}

ipcMain.handle('bench:report', (_event, report: unknown) => {
  const json = JSON.stringify(report, null, 2);
  const dir = benchMode ? process.cwd() : app.getPath('userData');
  const file = join(dir, 'bench-results.json');
  writeFileSync(file, json, 'utf8');
  if (benchMode) {
    process.stdout.write(`${json}\n`);
    setImmediate(() => app.quit());
  }
  return file;
});

void app.whenReady().then(() => {
  createWindow();
  if (benchMode) {
    setTimeout(() => {
      process.stderr.write('La prueba de GPU ha superado el tiempo máximo\n');
      app.exit(1);
    }, BENCH_TIMEOUT_MS).unref();
  }
});

app.on('window-all-closed', () => app.quit());
