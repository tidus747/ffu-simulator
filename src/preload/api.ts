/** API que el preload expone a la interfaz como `window.ffu`. Solo tipos. */
export interface FfuApi {
  versions: { electron: string; chrome: string; node: string };
  /** Guarda el informe de la prueba de GPU; en modo --bench además cierra la app. */
  reportBench(report: unknown): Promise<string>;
}
