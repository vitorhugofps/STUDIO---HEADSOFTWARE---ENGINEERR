/**
 * Utilidades de cor do brandbook: conversões, contraste e misturas.
 * Puras, sem dependências, usadas no servidor e nos testes.
 */

export type RGB = [number, number, number];

export function normHex(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return ('#' + s).toLowerCase();
  return fallback;
}

export function hexToRgb(hex: string): RGB {
  const h = normHex(hex, '#000000').slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function luminance(hex: string): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.35;
}

/** Cor de texto (entre as candidatas) com maior contraste sobre o fundo. */
export function inkFor(bg: string, candidates: string[] = ['#0a0a0a', '#f5f5f3']): string {
  let best = candidates[0];
  let bestC = 0;
  for (const c of candidates) {
    const k = contrast(bg, c);
    if (k > bestC) {
      bestC = k;
      best = c;
    }
  }
  return best;
}

export function rgbString(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/** CMYK aproximado (sem perfil de cor): suficiente para o manual indicar a referência de impressão. */
export function cmykString(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.999) return '0 0 0 100';
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);
  return [c, m, y, k].map((v) => Math.round(v * 100)).join(' ');
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r0, g0, b0] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r0) h = (g0 - b0) / d + (g0 < b0 ? 6 : 0);
  else if (max === g0) h = (b0 - r0) / d + 2;
  else h = (r0 - g0) / d + 4;
  return [h * 60, s, l];
}

/** Nome genérico da cor pelo matiz, usado quando a IA não batizou a cor. */
export function colorFamily(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  if (l < 0.12) return 'Preto';
  if (l > 0.93) return 'Branco';
  if (s < 0.12) return l < 0.5 ? 'Grafite' : 'Cinza';
  if (h < 15 || h >= 345) return 'Vermelho';
  if (h < 40) return 'Laranja';
  if (h < 65) return 'Amarelo';
  if (h < 160) return 'Verde';
  if (h < 200) return 'Turquesa';
  if (h < 250) return 'Azul';
  if (h < 290) return 'Violeta';
  return 'Rosa';
}

/** Deixa uma cor um pouco mais escura ou clara mantendo o matiz (para superfícies e tons de apoio). */
export function shade(hex: string, amount: number): string {
  return amount < 0 ? mixHex(hex, '#000000', -amount) : mixHex(hex, '#ffffff', amount);
}
