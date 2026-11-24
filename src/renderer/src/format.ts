const cache = new Map<number, Intl.NumberFormat>();

/** Número con formato español y `digits` decimales. */
export function fmt(value: number, digits = 1): string {
  let f = cache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    cache.set(digits, f);
  }
  return f.format(value);
}

export function fmtBytes(mib: number): string {
  return mib >= 1024 ? `${fmt(mib / 1024, 2)} GB` : `${fmt(mib, 0)} MB`;
}
