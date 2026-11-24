# FFU Simulator

Aplicación de escritorio (Windows) para simular cómo circula el aire impulsado por las FFU dentro de una máquina, cómo interactúa con las estructuras internas y cómo se reparte el calor de los componentes.

> **Estado: Fase 0.** Hay un esqueleto de la aplicación, un motor LBM D3Q19 validado en CPU y en GPU, una demo en vivo y una prueba de rendimiento. La arquitectura y el plan completo están en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Requisitos

- Windows 10/11 con una GPU compatible con WebGPU (Direct3D 12).
- Node.js 22.12 o superior (el repo fija la 26 en `.node-version`).

## Uso

```bash
npm install
npm run dev        # aplicación en modo desarrollo
npm run bench      # prueba de GPU sin ventana; guarda bench-results.json y sale
npm test           # tests del núcleo (Vitest)
npm run lint
npm run typecheck
npm run dist       # instalador de Windows en release/
```

## Estructura

```
src/main/       proceso principal de Electron
src/preload/    API mínima expuesta a la interfaz (window.ffu)
src/renderer/   interfaz React
src/worker/     hilo de simulación: dueño del dispositivo WebGPU, calcula y dibuja
src/core/       TypeScript puro y testeable: unidades, red D3Q19, solver CPU, kernels WGSL
tests/          tests del núcleo
docs/           arquitectura y decisiones
legacy/         código original del simulador web, solo como referencia mientras se porta
```

## Origen

Parte de un fork de [wind-tunnel-simulator](https://github.com/ambystomatechnologies/wind-tunnel-simulator) de Ambystoma Technologies, cuyo código original se conserva en `legacy/`. El repositorio original no incluye fichero de licencia (su README menciona MIT); hay que aclararlo con el autor antes de reutilizar ese código.
