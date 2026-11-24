# Arquitectura · Simulador de flujo FFU

> Estado: **aprobada** · 24/11/2026 · Fase 0 en curso

## 1. Objetivo

Aplicación de escritorio para Windows que simula el aire impulsado por las FFU dentro de una máquina (≈ 3 × 1,6 × 2 m): por dónde circula, cómo choca con las estructuras internas y cómo se reparte el calor de los componentes.

El uso principal es **comparar diseños y entender el comportamiento turbulento**: estelas, recirculaciones, zonas muertas y penachos térmicos. No se busca certificar valores absolutos.

El proyecto parte de un fork de *wind-tunnel-simulator* (web, JavaScript). Del original se conserva la experiencia de uso: visualización interactiva, sondas, informes y vídeo. Se reescriben el motor físico, el modelo de datos y la importación de geometría, porque los motores originales están pensados solo para un túnel, no conservan la masa y no trabajan en unidades físicas.

## 2. Decisiones

| Tema | Decisión | Motivo | Alternativas descartadas |
| --- | --- | --- | --- |
| Plataforma | Windows | Requisito actual | — |
| Aplicación de escritorio | **Electron** | Chromium con WebGPU en *workers*, Node para el acceso a ficheros y todo el código en TypeScript. Genera un `.exe` con instalador y ventana propia, sin navegador ni conexión. WebGPU es solo la API para hablar con la GPU: en Windows se traduce a Direct3D 12 | Tauri: viable al ser solo Windows, pero obliga a usar Rust y no aporta nada si la simulación corre en WebGPU |
| Lenguaje e interfaz | **TypeScript + Vite + React** | La interfaz tendrá muchos paneles (árbol de piezas, propiedades, sondas, gráficas) | JavaScript sin módulos del original |
| Dimensión | **Motor 3D; el 2D es un modo del mismo motor** | La turbulencia es un fenómeno 3D, la geometría ya existe en 3D en el CAD y así solo hay un motor que validar | Solo 2D |
| Simulación del aire | **LBM D3Q19 en unidades físicas**, colisión estable (TRT o regularizada) + modelo de turbulencia LES Smagorinsky | Conserva la masa, la geometría sale directamente de los vóxeles, cada celda se calcula de forma independiente (ideal para GPU) y es transitorio, así que se ve la turbulencia | Navier-Stokes por proyección: resolver la presión es caro en GPU. RANS estacionario: promedia la turbulencia, que es justo lo que se quiere ver |
| Temperatura | **Volúmenes finitos sobre la misma malla**, con flotabilidad (Boussinesq) y conducción en sólidos | Permite un material distinto por celda y avanzar el cálculo térmico con pasos más largos que los del aire | LBM térmico |
| Cálculo | **WebGPU en un Web Worker**; versión CPU solo para tests con mallas pequeñas | Una malla 3D útil no es viable en CPU | CUDA, que obliga a usar GPU NVIDIA |
| Plan B de cálculo | Simulación nativa (Rust + wgpu) en un proceso aparte, detrás de la misma API | Por si la memoria, los límites de buffers o el rendimiento de WebGPU no bastan | — |
| Geometría | **STEP del CAD** (conserva el árbol de ensamblaje y los nombres), además de STL, OBJ y 3MF. SVG opcional para bocetos 2D | Las máquinas ya existen en CAD | SVG como entrada principal |
| Herramientas existentes | No integrarlas | OpenFOAM es el estándar, pero es pesado y no es interactivo; puede servir para validar casos concretos. FluidX3D es un LBM en GPU excelente, pero su licencia prohíbe el uso comercial | — |

## 3. Arquitectura

```
┌─ Electron main (Node) ───────────────────────────────────────────┐
│ ventanas · menús · diálogos · E/S de proyectos · vigilar el CAD  │
└────────────────┬─────────────────────────────────────────────────┘
                 │ comunicación tipada (preload / contextBridge)
┌─ Interfaz (React) ───────────────────────────────────────────────┐
│ árbol de piezas y roles · propiedades · sondas · gráficas        │
│ casos y comparación · informe y vídeo                            │
└────────────────┬─────────────────────────────────────────────────┘
                 │ mensajes + buffers transferibles
┌─ Hilo de simulación (posee el dispositivo WebGPU) ───────────────┐
│ voxelizado → simulación (aire + calor) → estadísticas y métricas │
│ visor: cortes, partículas e isosuperficies en un OffscreenCanvas │
│ (los campos se dibujan desde la GPU, sin copiarlos a la CPU)     │
└──────────────────────────────────────────────────────────────────┘
```

Módulos de `src/core/` (TypeScript puro, sin dependencias del navegador, se pueden probar con Vitest):

| Módulo | Responsabilidad |
| --- | --- |
| `units` | Conversión entre unidades físicas y de la red (dx, dt, ν, α) |
| `project` | Esquema del proyecto (zod), versiones y migraciones |
| `geometry` | Importadores (STEP, STL, OBJ, 3MF, SVG), árbol de piezas, reglas de roles, simplificación |
| `mesh` | Voxelizado 3D y de cortes 2D, diagnósticos de la malla |
| `solver` | API común, kernels WGSL, versión CPU de referencia, condiciones de contorno |
| `post` | Sondas, estadísticas (media y RMS), caudales, métricas y convergencia |

A la interfaz solo vuelven datos pequeños: valores de sondas, métricas y progreso. Los campos completos se leen únicamente al exportar o guardar resultados.

## 4. Modelo físico

### 4.1 Aire

- **Propiedades por defecto (editables):** ν = 1,5·10⁻⁵ m²/s, ρ = 1,2 kg/m³, cp = 1005 J/(kg·K) y k = 0,026 W/(m·K).
- **Método:** LBM D3Q19 con colisión TRT o regularizada y LES Smagorinsky (Cs ≈ 0,1–0,17). Las fuerzas (flotabilidad y zonas porosas) se introducen con el esquema de Guo.
- **Unidades:** el usuario elige el tamaño de celda. El paso de tiempo se ajusta para que la velocidad máxima esperada quede en torno a 0,1 en unidades de la red, lo que mantiene la simulación estable.
- **Modo 2D:** es la misma malla con una sola celda de espesor y periodicidad en la dirección perpendicular al corte. En ese caso D3Q19 se reduce exactamente a D2Q9, así que no hay que mantener un segundo motor. Cuesta unas 2 veces más que un D2Q9 dedicado, lo cual es aceptable.

### 4.2 Calor

- **Ecuación:** advección y difusión de la temperatura con volúmenes finitos explícitos (advección TVD, difusión centrada), tanto en el aire como en los sólidos. La conductividad en las caras entre materiales distintos se calcula con la media armónica.
- **Difusividad del aire:** la molecular más la turbulenta (ν_t / Pr_t, con Pr_t ≈ 0,85).
- **Flotabilidad (Boussinesq):** F = −ρ·β·(T − T_ref)·g. Es imprescindible: con 0,45 m/s, 1 m de altura y 20 °C de sobretemperatura, el número de Richardson es ≈ 3, es decir, los penachos térmicos compiten con el flujo descendente de la FFU.
- **Pasos de tiempo:** el cálculo térmico usa pasos varias veces más largos que el del aire.
- **Modo estacionario:** se puede reducir la capacidad térmica de los sólidos para converger antes; el resultado final no cambia.
- **Radiación:** no se modela.

### 4.3 Condiciones de contorno

| Elemento | Modelo |
| --- | --- |
| Paredes y sólidos | El aire no desliza sobre ellos. En lo térmico, conducen el calor según su material o son adiabáticos |
| FFU | Velocidad impuesta en la cara de impulsión (por defecto hacia abajo), con temperatura e intensidad de turbulencia de entrada. Fase 6: curva del ventilador + pérdida del filtro para obtener el punto de trabajo real |
| Salidas | Presión ambiente (0 Pa relativos) con la pérdida de carga de la rejilla (% de área abierta o coeficiente K). En nuestras máquinas el aire sale por **rejillas en la parte inferior**. Se detecta el retroflujo, es decir, aire que entra por una salida |
| Margen de sala (opcional) | Para máquinas sin salidas definidas: se simula la máquina dentro de un volumen de sala con los bordes a presión ambiente y el aire sale por donde haya huecos. Añade celdas. No hace falta en el caso habitual (rejillas inferiores) |
| Chapas perforadas y rejillas | Zona porosa con pérdida de carga (Darcy-Forchheimer), definida por el % de área abierta o por un coeficiente K |
| Fuentes de calor | Potencia en W asignada a una pieza. Se reparte por su volumen como q''' = P/V y se conduce hasta su superficie |
| Carcasa | Adiabática o con un coeficiente de convección h hacia el ambiente |

### 4.4 Modos de cálculo

- **Interactivo:** se ve la evolución en tiempo real y los parámetros se pueden cambiar en caliente.
- **Estadísticamente estacionario:** el cálculo corre hasta que las medias se estabilizan, acumula la media y el RMS de cada campo y para automáticamente.
- **Térmico estacionario:** el cálculo corre hasta que las temperaturas dejan de cambiar.

### 4.5 Limitaciones (la aplicación debe mostrarlas)

- **Resolución:** con celdas de 1–2 cm en 3D desaparecen los detalles menores y no se resuelve la capa límite. Sí se ven las estructuras grandes: estelas, desprendimientos en aristas, penachos y recirculaciones.
- **Modo 2D:** la turbulencia se comporta de otra forma. En 2D los remolinos se fusionan y crecen en vez de romperse, así que sirve para ver patrones globales pero no para juzgar la turbulencia.
- **Modelado:** la turbulencia se modela con LES y no hay radiación. Los resultados sirven para comparar diseños; los valores absolutos deberían contrastarse con medidas reales (anemómetro, termopares).

### 4.6 Validación (tests automáticos)

| Caso | Referencia |
| --- | --- |
| Flujo de Poiseuille (modo 2D) | Solución analítica |
| Cavidad con tapa móvil (modo 2D) | Ghia, Ghia y Shin (1982) |
| Cavidad calentada por un lado (modo 2D) | de Vahl Davis (1983) |
| Flujo en conducto cuadrado (3D) | Solución analítica en serie |
| Cavidad cúbica con tapa móvil (3D) | Albensoeder y Kuhlmann (2005) |
| Cubo calentado por un lado (3D) | Tric, Labrosse y Betrouni (2000) |
| Balance de masas | Caudal de las FFU = suma de caudales de salida, con menos de un 1 % de error |
| Equivalencia CPU ↔ GPU | Resultados iguales en mallas pequeñas |

## 5. Geometría

### 5.1 Importación

- **STEP:** con [occt-import-js](https://github.com/kovacsv/occt-import-js) (OpenCascade compilado a WebAssembly, licencia LGPL). Conserva el árbol de ensamblaje, los nombres y los colores. Se validará en la Fase 0 con una máquina real.
- **STL, OBJ y 3MF:** con los cargadores de three.js.
- **SVG:** opcional, para bocetos 2D rápidos (Fase 6).
- **Recarga:** al volver a exportar el CAD, la aplicación re-importa la geometría y conserva los roles.

### 5.2 Roles

| Rol | Uso |
| --- | --- |
| `wall` | Carcasa y chapas. Se voxeliza de forma conservadora para que no haya fugas |
| `solid` | Componente interno con métricas propias. Si tiene potencia, es una fuente de calor |
| `ffu` | Impulsión: velocidad, dirección y temperatura |
| `outlet` | Abertura a ambiente |
| `porous` | Chapa perforada, rejilla o filtro: % de área abierta o coeficiente K |
| `probe` | Punto, línea o plano de medida (por ejemplo, el plano de trabajo) |
| `ignore` | Piezas irrelevantes (tornillería, cables) |

- **Asignación:** mediante reglas por nombre configurables y haciendo clic en el árbol o en el visor. Los roles se guardan por la ruta de la pieza en el ensamblaje, así que re-importar un STEP actualizado los conserva.
- **Convención de nombres sugerida en el CAD:** `FFU_01`, `HEAT_80W_Fuente24V`, `OUTLET_RejillaTrasera`, `POROUS_40_Suelo`, `IGNORE_Tornilleria`. Lo que no siga la convención se trata como `solid`.
- **Materiales:** predefinidos y editables (aluminio, acero, acero inoxidable, plástico, FR4).

### 5.3 Simplificación

- Se pueden ignorar piezas por tamaño (por ejemplo, menores que una celda) o por nombre.
- Los conjuntos complejos se pueden tratar como su caja envolvente.
- **Chapas perforadas:** los agujeros reales no se pueden resolver con celdas de 1 cm, así que la pieza se marca como `porous` con su % de área abierta.

### 5.4 Voxelizado

- **Malla:** cartesiana y uniforme. Cada celda guarda su tipo, su material y la pieza a la que pertenece.
- **Paredes (`wall`):** voxelizado conservador, es decir, toda celda que toque la superficie se marca como sólida. Así una chapa de 1–2 mm no deja fugas aunque sea más fina que la celda.
- **Interior de los sólidos:** se determina por paridad de rayos.
- **Corte 2D:** se usa el mismo voxelizador con un dominio de una celda de espesor en el plano elegido. Las fuentes de calor mantienen su q''' y no hace falta ningún parámetro de profundidad.
- **Diagnóstico antes de simular:** fugas, bolsas de aire aisladas (se desactivan), FFU sin salida y % del volumen ocupado.

## 6. Dimensionado

Máquina de 3 × 1,6 × 2 m. Memoria GPU estimada con LBM en FP32: entre ~100 B por celda (un solo buffer de distribuciones) y ~180 B por celda (dos buffers).

| Celda | Malla | Celdas | Memoria GPU aprox. |
| --- | --- | --- | --- |
| 2 cm | 150 × 80 × 100 | 1,2 M | 0,1–0,2 GB |
| 1,5 cm | 200 × 107 × 134 | 2,9 M | 0,3–0,5 GB |
| 1 cm | 300 × 160 × 200 | 9,6 M | 1,0–1,7 GB |
| 7,5 mm | 400 × 214 × 267 | 23 M | 2,3–4 GB |
| 2D, 2 mm (corte de 3 × 2 m) | 1500 × 1000 | 1,5 M | 0,15–0,3 GB |

### Medido en la Fase 0 (RTX 4070 Laptop, 8 GB, WebGPU)

Kernel D3Q19 de flujo (BGK, sin LES ni temperatura) en una caja cerrada con un bloque interior. Memoria real: 156 B por celda (FP32, dos copias de las poblaciones y la máscara). El tiempo físico supone dt para 1 m/s de velocidad máxima.

| Celda | Malla (largo × alto × ancho) | Celdas | Memoria GPU | M celdas/s | Pasos/s | Tiempo físico por segundo real |
| --- | --- | --- | --- | --- | --- | --- |
| 2 cm | 150 × 100 × 80 | 1,2 M | 0,17 GB | 1.304 | 1.087 | 2,2 s (interactivo) |
| 1,5 cm | 200 × 133 × 107 | 2,8 M | 0,41 GB | 1.318 | 463 | 0,69 s |
| 1 cm | 300 × 200 × 160 | 9,6 M | 1,39 GB | 1.328 | 138 | 0,14 s: 30 s físicos (flujo desarrollado) en ~3,6 min |
| 7,5 mm | 400 × 267 × 213 | 22,7 M | 3,30 GB | 1.329 | 58 | 0,044 s |

- Unos 207 GB/s de tráfico de memoria, alrededor del 80 % del máximo teórico de la GPU (256 GB/s). WebGPU no es el cuello de botella; un kernel nativo apenas ganaría.
- Referencia sin GPU dedicada (Intel Iris Xe del mismo portátil): unos 300 M celdas/s.
- Límites de WebGPU en este equipo: 2 GB por buffer y 16 buffers por shader. Todas las mallas caben en un único buffer por copia.
- El coste real será mayor cuando se añadan LES, temperatura y estadísticas.
- El almacenamiento de poblaciones en FP16 (la GPU lo admite) reduciría la memoria y el tráfico casi a la mitad. Es una optimización de la Fase 5.

## 7. Visualización y análisis

- **Visor 3D:**
  - geometría con transparencia por rol;
  - cortes X/Y/Z móviles con cualquier campo;
  - partículas y líneas de corriente sembradas desde la FFU o desde una línea o plano;
  - isosuperficies de temperatura y del criterio Q (la forma habitual de ver los vórtices turbulentos en 3D).
- **Vista 2D:** para los cortes y el modo 2D. Hereda los modos de visualización de la web original.
- **Campos:** velocidad, presión (Pa), temperatura (°C), vorticidad, criterio Q, edad del aire (tiempo desde que el aire salió de la FFU), y la media y el RMS de cada campo (intensidad de turbulencia).
- **Sondas de punto, línea o plano:** series temporales y espectro, para ver las frecuencias dominantes de desprendimiento.
- **Métricas para FFU:**
  - uniformidad y ángulo del flujo descendente en el plano de trabajo;
  - zonas muertas;
  - caudal por salida, retroflujo y sobrepresión interior;
  - temperatura media y máxima de cada pieza, y el calor que evacua.
- **Resultados:** comparación A/B entre casos con mapa de diferencias, exportación a CSV/XLSX, informe HD y vídeo.

## 8. Ficheros

| Fichero | Contenido |
| --- | --- |
| `.ffuproj` (zip) | `project.json` (validado y versionado), la geometría teselada en caché (para abrir sin re-importar) y la ruta al CAD original |
| `.ffures` | Campos (FP16 comprimido), estadísticas, series de sondas y un *checkpoint* para reanudar el cálculo |

## 9. Estructura del repositorio

```
src/main/        proceso principal de Electron
src/preload/     API tipada expuesta a la interfaz (window.ffu)
src/renderer/    interfaz React
src/worker/      hilo de simulación: dueño del dispositivo WebGPU, calcula y dibuja
src/core/        units · project · geometry · mesh · solver (cpu, webgpu) · post · bench
tests/           unitarios + casos de validación
examples/        geometrías de ejemplo
docs/            este documento, convención de nombres, modelo físico
legacy/          código original, solo como referencia mientras se porta
```

## 10. Fases

| Fase | Contenido | Entregable |
| --- | --- | --- |
| **0. Base y pruebas de viabilidad** | Etiquetar el estado actual y mover el original a `legacy/`. Esqueleto Electron + TS + React, lint, Vitest, CI e instalador. **Prueba 1:** kernel D3Q19 mínimo en WebGPU, midiendo celdas por segundo y límites de memoria en vuestras GPU con 1–10 M celdas. **Prueba 2:** importar el STEP de una máquina real (tiempo, memoria, nombres conservados) | Instalador funcional y una **decisión de seguir adelante o no**: si WebGPU se queda corto, se pasa al plan B nativo antes de construir encima |
| **1. Geometría** | Formato de proyecto, importación STEP/STL, árbol de piezas, roles y reglas, simplificación, voxelizado 3D y de cortes 2D, diagnósticos, visor de geometría y vóxeles | Abrir una máquina real y ver su malla con roles y avisos |
| **2. Aire** | D3Q19 en GPU (con versión CPU de referencia), condiciones de contorno, LES, modo 2D, cortes, partículas, balance de masas y validación | Flujo de las FFU dentro de la máquina, con los tests de validación pasando |
| **3. Calor** | Volúmenes finitos 3D, fuentes de calor, flotabilidad, sólidos conductores, carcasa con h, isosuperficies de temperatura y validación | Penachos térmicos interactuando con el flujo de las FFU |
| **4. Análisis** | Media y RMS, criterio Q, sondas con espectro, modos estacionarios, métricas FFU, exportación, informe, vídeo y comparación A/B | Informe de turbulencia y temperaturas de una máquina real |
| **5. Producción** | Cola de casos (por ejemplo, durante la noche), *checkpoints*, guardar y abrir resultados, optimizaciones (FP16, un solo buffer) | Varios diseños calculados y comparados sin intervención |
| **6. Avanzado** | Curva del ventilador + filtro, partículas con inercia y sedimentación, bocetos SVG, barridos de parámetros | Según prioridades |

### Estado de la Fase 0

- **Hecho:**
  - etiqueta `upstream-base` y código original en `legacy/`;
  - esqueleto Electron 45 + Vite 8 + React 19 + TypeScript 6, con ESLint, Prettier, Vitest y CI;
  - instalador NSIS;
  - LBM D3Q19 en CPU (referencia) y en WebGPU, generado a partir de las mismas tablas;
  - demo en vivo (cilindro en canal 3D) dibujada desde la GPU en un *worker*;
  - prueba de viabilidad (`npm run bench`). **Resultado: viable con WebGPU** (§6).
- **Validación del kernel:** Poiseuille con un 0,24 % de error, y CPU ↔ GPU con una diferencia máxima de 1,1·10⁻⁶ tras 200 pasos.
- **Pendiente:** prueba 2 (importar un STEP real).
- **Notas técnicas:**
  - En Windows, Chromium ignora `powerPreference` de WebGPU (crbug.com/369219127) y usaba la gráfica integrada. El switch `force_high_performance_gpu` en el proceso principal hace que use la dedicada.
  - TypeScript se queda en la 6.0 porque typescript-eslint aún no admite la 7.

## 11. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Rendimiento o límites de WebGPU con mallas 3D grandes | **Descartado en la Fase 0** (§6). Plan B nativo (Rust + wgpu) disponible detrás de la misma API si cambiara |
| Estabilidad del LBM con la viscosidad del aire y celdas gruesas | Colisión estable + LES + validación; limitar la velocidad máxima en unidades de la red |
| STEP muy pesados (tornillería, cables) | Simplificación por tamaño y nombre; caché de la geometría teselada |
| Fugas por chapas finas y perforados no resolubles | Voxelizado conservador, rol `porous`, diagnóstico previo |
| Tiempos térmicos largos | Pasos térmicos más largos, capacidad térmica reducida en modo estacionario, GPU |
| Interpretación excesiva de resultados cualitativos | Limitaciones visibles en la aplicación; contraste con medidas reales |
| Licencia del código original (el README dice MIT, pero no hay fichero LICENSE) | Confirmarla con el autor antes de portar su código |

## 12. Pendiente de definir

- Un STEP real de una máquina (aunque esté simplificado) para la prueba 2 de la Fase 0.
- Datos de las FFU (Astrofan): curva presión-caudal del ventilador en vuestra consigna de uso, pérdida de carga del filtro frente a la velocidad, uniformidad de la velocidad en la cara del filtro y, si lo tienen, el nivel de turbulencia a la salida.
- % de área abierta (o coeficiente K) de las rejillas inferiores de salida.
- Licencia del repositorio original.

Resuelto: la aplicación se usará en un portátil con RTX 4070 Laptop (8 GB), y el aire sale por rejillas en la parte inferior.
