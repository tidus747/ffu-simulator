/**
 * Generación de los shaders WGSL del LBM D3Q19 a partir de las mismas tablas que usa la CPU.
 * El acceso a cada población depende de en qué buffer (grupo) cae, así que el código se
 * genera desenrollado para cada dirección.
 */

import { CX, CY, CZ, OPP, Q } from '../lattice/d3q19';

/** Parámetros comunes del paso y de la inicialización (64 bytes). */
export const PARAMS_WGSL = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nz: u32, n: u32,
  omega: f32, fx: f32, fy: f32, fz: f32,
  dispatchX: u32, spongeX0: u32, spongeStrength: f32, spongeUx: f32,
  initUx: f32, initUy: f32, initUz: f32, initRho: f32,
};
`;
export const PARAMS_BYTES = 64;

const WEIGHTS_WGSL = /* wgsl */ `
const W0: f32 = 1.0 / 3.0;
const W1: f32 = 1.0 / 18.0;
const W2: f32 = 1.0 / 36.0;
`;

function weightName(q: number): string {
  return q === 0 ? 'W0' : q <= 6 ? 'W1' : 'W2';
}

/** Producto escalar c_q · (a, b, c) como expresión WGSL simplificada. */
function dotExpr(q: number, a: string, b: string, c: string): string {
  const terms: string[] = [];
  const add = (coef: number, name: string) => {
    if (coef === 1) terms.push(terms.length ? `+ ${name}` : name);
    else if (coef === -1) terms.push(terms.length ? `- ${name}` : `-${name}`);
  };
  add(CX[q]!, a);
  add(CY[q]!, b);
  add(CZ[q]!, c);
  return terms.length ? `(${terms.join(' ')})` : '0.0';
}

function sumExpr(coefs: readonly number[]): string {
  const terms: string[] = [];
  for (let q = 0; q < Q; q++) {
    if (coefs[q] === 1) terms.push(terms.length ? `+ f${q}` : `f${q}`);
    else if (coefs[q] === -1) terms.push(terms.length ? `- f${q}` : `-f${q}`);
  }
  return terms.join(' ');
}

interface Accessor {
  (q: number, index: string): string;
}

function makeAccessor(groups: number[][], prefix: string): Accessor {
  const where = new Map<number, { g: number; local: number }>();
  groups.forEach((g, gi) => g.forEach((q, local) => where.set(q, { g: gi, local })));
  return (q, index) => {
    const w = where.get(q);
    if (!w) throw new Error(`Dirección ${q} sin buffer asignado`);
    const offset = w.local === 0 ? '' : `${w.local}u * n + `;
    return `${prefix}${w.g}[${offset}${index}]`;
  };
}

/** Lee las 19 poblaciones post-colisión de la celda `idx` y calcula rho y u (para render). */
function velocityFunction(groups: number[][]): string {
  const acc = makeAccessor(groups, 'src');
  const loads = Array.from({ length: Q }, (_, q) => `  let f${q} = ${acc(q, 'idx')};`).join('\n');
  return /* wgsl */ `
fn cellVelocity(idx: u32) -> vec4<f32> {
  let n = R.n;
${loads}
  let rho = ${sumExpr(Array(Q).fill(1))};
  let jx = ${sumExpr(CX)};
  let jy = ${sumExpr(CY)};
  let jz = ${sumExpr(CZ)};
  // Post-colisión el momento es j_pre + F: se resta medio paso de la fuerza.
  let u = (vec3<f32>(jx, jy, jz) - 0.5 * vec3<f32>(R.fx, R.fy, R.fz)) / rho;
  return vec4<f32>(u, rho);
}
`;
}

export interface StepKernelOptions {
  groups: number[][];
  workgroupSize: number;
  sponge: boolean;
}

/** Paso fusionado: pull + rebote a mitad de enlace + colisión BGK con forzado de Guo. */
export function buildStepKernel({ groups, workgroupSize, sponge }: StepKernelOptions): string {
  const G = groups.length;
  const src = makeAccessor(groups, 'src');
  const dst = makeAccessor(groups, 'dst');
  const bindings = [
    '@group(0) @binding(0) var<uniform> P: Params;',
    '@group(0) @binding(1) var<storage, read> mask: array<u32>;',
    ...groups.map((_, g) => `@group(0) @binding(${2 + g}) var<storage, read> src${g}: array<f32>;`),
    ...groups.map(
      (_, g) => `@group(0) @binding(${2 + G + g}) var<storage, read_write> dst${g}: array<f32>;`,
    ),
  ].join('\n');

  const pull: string[] = [`  let f0 = ${src(0, 'idx')};`];
  for (let q = 1; q < Q; q++) {
    const xs = CX[q] === 1 ? 'xm' : CX[q] === -1 ? 'xp' : 'x';
    const ys = CY[q] === 1 ? 'ym' : CY[q] === -1 ? 'yp' : 'y0';
    const zs = CZ[q] === 1 ? 'zm' : CZ[q] === -1 ? 'zp' : 'z0';
    pull.push(
      `  var f${q}: f32;`,
      `  if ((m & ${1 << q}u) != 0u) { f${q} = ${src(OPP[q]!, 'idx')}; }`,
      `  else { f${q} = ${src(q, `${xs} + ${ys} + ${zs}`)}; }`,
    );
  }

  const collide: string[] = [];
  for (let q = 0; q < Q; q++) {
    const w = weightName(q);
    const cu = dotExpr(q, 'ux', 'uy', 'uz');
    const cf = dotExpr(q, 'fx', 'fy', 'fz');
    collide.push(
      `  {`,
      `    let cu = ${cu};`,
      `    let cf = ${cf};`,
      `    let feq = ${w} * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * usq);`,
      `    var post = f${q} - om * (f${q} - feq) + fk * ${w} * (3.0 * (cf - uf) + 9.0 * cu * cf);`,
    );
    if (sponge) {
      const cs = CX[q] === 0 ? '0.0' : CX[q] === 1 ? 'sux' : '-sux';
      collide.push(
        `    let ct = ${cs};`,
        `    post = post + sp * (${w} * (1.0 + 3.0 * ct + 4.5 * ct * ct - 1.5 * sux * sux) - post);`,
      );
    }
    collide.push(`    ${dst(q, 'idx')} = post;`, `  }`);
  }

  const spongeFn = sponge
    ? /* wgsl */ `
fn spongeFactor(x: u32) -> f32 {
  if (x < P.spongeX0) { return 0.0; }
  let t = f32(x - P.spongeX0) / max(1.0, f32(P.nx - 1u - P.spongeX0));
  return P.spongeStrength * t * t;
}
`
    : '';

  return /* wgsl */ `
${PARAMS_WGSL}
${WEIGHTS_WGSL}
${bindings}

const WG: u32 = ${workgroupSize}u;
const SOLID: u32 = 0x80000000u;
${spongeFn}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let idx = (wid.y * P.dispatchX + wid.x) * WG + lid;
  if (idx >= P.n) { return; }
  let m = mask[idx];
  if ((m & SOLID) != 0u) { return; }

  let n = P.n;
  let nx = P.nx;
  let ny = P.ny;
  let nz = P.nz;
  let x = idx % nx;
  let t = idx / nx;
  let y = t % ny;
  let z = t / ny;
  let sxy = nx * ny;
  let xm = select(x - 1u, nx - 1u, x == 0u);
  let xp = select(x + 1u, 0u, x == nx - 1u);
  let y0 = y * nx;
  let ym = select(y - 1u, ny - 1u, y == 0u) * nx;
  let yp = select(y + 1u, 0u, y == ny - 1u) * nx;
  let z0 = z * sxy;
  let zm = select(z - 1u, nz - 1u, z == 0u) * sxy;
  let zp = select(z + 1u, 0u, z == nz - 1u) * sxy;

${pull.join('\n')}

  let rho = ${sumExpr(Array(Q).fill(1))};
  let jx = ${sumExpr(CX)};
  let jy = ${sumExpr(CY)};
  let jz = ${sumExpr(CZ)};
  let fx = P.fx;
  let fy = P.fy;
  let fz = P.fz;
  let inv = 1.0 / rho;
  let ux = (jx + 0.5 * fx) * inv;
  let uy = (jy + 0.5 * fy) * inv;
  let uz = (jz + 0.5 * fz) * inv;
  let usq = ux * ux + uy * uy + uz * uz;
  let uf = ux * fx + uy * fy + uz * fz;
  let om = P.omega;
  let fk = 1.0 - 0.5 * om;
${sponge ? '  let sp = spongeFactor(x);\n  let sux = P.spongeUx;' : ''}

${collide.join('\n')}
}
`;
}

/** Inicialización en equilibrio con densidad y velocidad uniformes. */
export function buildInitKernel(groups: number[][], workgroupSize: number): string {
  const out = makeAccessor(groups, 'out');
  const bindings = [
    '@group(0) @binding(0) var<uniform> P: Params;',
    ...groups.map(
      (_, g) => `@group(0) @binding(${1 + g}) var<storage, read_write> out${g}: array<f32>;`,
    ),
  ].join('\n');
  const writes = Array.from({ length: Q }, (_, q) => {
    const cu = dotExpr(q, 'ux', 'uy', 'uz');
    return `  { let cu = ${cu}; ${out(q, 'idx')} = ${weightName(q)} * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * usq); }`;
  }).join('\n');
  return /* wgsl */ `
${PARAMS_WGSL}
${WEIGHTS_WGSL}
${bindings}

const WG: u32 = ${workgroupSize}u;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let idx = (wid.y * P.dispatchX + wid.x) * WG + lid;
  if (idx >= P.n) { return; }
  let n = P.n;
  let rho = P.initRho;
  let ux = P.initUx;
  let uy = P.initUy;
  let uz = P.initUz;
  let usq = ux * ux + uy * uy + uz * uz;
${writes}
}
`;
}

/** Parámetros del render de cortes (48 bytes). */
export const RENDER_PARAMS_BYTES = 48;

/**
 * Render de un corte z = cte: triángulo a pantalla completa; el fragment shader calcula la
 * velocidad de cada celda directamente desde los buffers de poblaciones (sin copias a CPU).
 */
export function buildSliceShader(groups: number[][]): string {
  const bindings = [
    '@group(0) @binding(0) var<uniform> R: RenderParams;',
    '@group(0) @binding(1) var<storage, read> mask: array<u32>;',
    ...groups.map((_, g) => `@group(0) @binding(${2 + g}) var<storage, read> src${g}: array<f32>;`),
  ].join('\n');
  return /* wgsl */ `
struct RenderParams {
  nx: u32, ny: u32, nz: u32, n: u32,
  zSlice: u32, mode: u32, scale: f32, fx: f32,
  fy: f32, fz: f32, pad0: f32, pad1: f32,
};
${bindings}

const SOLID: u32 = 0x80000000u;
${velocityFunction(groups)}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = corners[i];
  var o: VOut;
  o.pos = vec4<f32>(p, 0.0, 1.0);
  o.uv = 0.5 * (p + vec2<f32>(1.0, 1.0));
  return o;
}

// Viridis aproximado con 5 paradas.
fn viridis(t: f32) -> vec3<f32> {
  var stops = array<vec3<f32>, 5>(
    vec3<f32>(0.267, 0.005, 0.329),
    vec3<f32>(0.231, 0.322, 0.545),
    vec3<f32>(0.129, 0.569, 0.549),
    vec3<f32>(0.369, 0.788, 0.384),
    vec3<f32>(0.992, 0.906, 0.145),
  );
  let s = clamp(t, 0.0, 1.0) * 4.0;
  let i = min(u32(floor(s)), 3u);
  return mix(stops[i], stops[i + 1u], s - f32(i));
}

// Divergente azul-blanco-rojo para la vorticidad.
fn diverging(t: f32) -> vec3<f32> {
  let s = clamp(t, 0.0, 1.0);
  let blue = vec3<f32>(0.230, 0.299, 0.754);
  let white = vec3<f32>(0.950, 0.950, 0.950);
  let red = vec3<f32>(0.706, 0.016, 0.150);
  if (s < 0.5) { return mix(blue, white, s * 2.0); }
  return mix(white, red, (s - 0.5) * 2.0);
}

fn velocityOrZero(idx: u32) -> vec3<f32> {
  if ((mask[idx] & SOLID) != 0u) { return vec3<f32>(0.0); }
  return cellVelocity(idx).xyz;
}

@fragment
fn fs(vin: VOut) -> @location(0) vec4<f32> {
  let x = min(u32(vin.uv.x * f32(R.nx)), R.nx - 1u);
  let y = min(u32(vin.uv.y * f32(R.ny)), R.ny - 1u);
  let idx = x + R.nx * (y + R.ny * R.zSlice);
  if ((mask[idx] & SOLID) != 0u) { return vec4<f32>(0.16, 0.18, 0.22, 1.0); }
  if (R.mode == 0u) {
    let speed = length(cellVelocity(idx).xyz);
    return vec4<f32>(viridis(speed * R.scale), 1.0);
  }
  let xm = select(idx - 1u, idx, x == 0u);
  let xp = select(idx + 1u, idx, x == R.nx - 1u);
  let ym = select(idx - R.nx, idx, y == 0u);
  let yp = select(idx + R.nx, idx, y == R.ny - 1u);
  let w = 0.5 * (velocityOrZero(xp).y - velocityOrZero(xm).y)
        - 0.5 * (velocityOrZero(yp).x - velocityOrZero(ym).x);
  return vec4<f32>(diverging(0.5 + w * R.scale), 1.0);
}
`;
}
