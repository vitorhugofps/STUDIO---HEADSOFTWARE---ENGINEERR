/**
 * Renderizador do brandbook: HTML único, navegável, com capítulos em campos de cor
 * (mesma estrutura editorial do manual do Studio Impacto), pronto para abrir no navegador,
 * baixar como arquivo ou imprimir em PDF.
 */

import type { BrandbookData, Swatch } from './model';
import { contrast, inkFor, isDark, mixHex, shade } from './color';

export type RenderOptions = {
  /** CSS @font-face já com as fontes embutidas (base64). Se vazio, usa o link do Google Fonts. */
  fontsCss?: string;
  /** Links de ação dentro do app (aparecem na barra). Em arquivo exportado ficam vazios. */
  actions?: { html?: string; pdf?: string };
  /** Abre a caixa de impressão assim que as fontes carregarem (usado pelo PDF do navegador). */
  autoPrint?: boolean;
  /** Mostra a faixa "exemplo" quando o conteúdo foi gerado sem IA. */
  exampleBanner?: boolean;
};

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const attr = esc;
const nl2 = (v: string) => esc(v).replace(/\n+/g, '<br>');
const li = (items: string[], cls = '') => items.map((x) => `<li${cls ? ` class="${cls}"` : ''}>${esc(x)}</li>`).join('');
const slug = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function fontStack(family: string, kind: 'display' | 'text') {
  const fb = kind === 'display' ? '"Barlow Condensed", "Oswald", "Arial Narrow", Impact, sans-serif' : '"Instrument Sans", "Helvetica Neue", Arial, sans-serif';
  return `"${family.replace(/"/g, '')}", ${fb}`;
}

function googleFontsLink(families: string[]) {
  if (!families.length) return '';
  const q = families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

/* ------------------------------------------------------------------ */
/* Logo: imagem enviada pelo cliente ou logotipo tipográfico            */
/* ------------------------------------------------------------------ */

function logoMark(d: BrandbookData, opts: { color?: string; dot?: string; size?: string; mono?: boolean } = {}) {
  const color = opts.color || 'currentColor';
  const dot = opts.mono ? color : opts.dot || 'var(--accent)';
  if (d.logo.src) {
    return `<img class="logo-img" src="${attr(d.logo.src)}" alt="${attr(d.logo.alt)}" style="${opts.size ? `height:${opts.size};` : ''}">`;
  }
  const sub = d.logo.sub ? `<small>${esc(d.logo.sub)}</small>` : '';
  // Nomes longos encolhem em relação ao tamanho do contêiner para nunca estourar o quadro.
  const scale = Math.min(1, 9 / Math.max(4, d.logo.wordmark.length)).toFixed(2);
  const size = opts.size ? `font-size:calc(${opts.size} * ${scale});` : scale !== '1.00' ? `font-size:${scale}em;` : '';
  return `<span class="wm" style="color:${color};${size}" role="img" aria-label="${attr(d.logo.alt)}"><b>${esc(d.logo.wordmark)}<i style="background:${dot}"></i></b>${sub}</span>`;
}

function symbolMark(d: BrandbookData, color = 'currentColor', dot = 'var(--accent)') {
  return `<span class="sym" style="color:${color}" aria-hidden="true"><b>${esc(d.logo.initial)}<i style="background:${dot}"></i></b></span>`;
}

/* ------------------------------------------------------------------ */
/* CSS                                                                  */
/* ------------------------------------------------------------------ */

function css(d: BrandbookData) {
  const p = d.palette;
  const accentInk = inkFor(p.accent, [p.dark, p.light, '#0a0a0a', '#ffffff']);
  const primaryInk = inkFor(p.primary, [p.dark, p.light, '#0a0a0a', '#ffffff']);
  const accent2Ink = inkFor(p.accent2, [p.dark, p.light, '#0a0a0a', '#ffffff']);
  const surface = shade(p.dark, 0.07);
  const surface2 = shade(p.dark, 0.13);
  const soft = p.soft;
  const softInk = inkFor(soft, [p.dark, '#0a0a0a']);
  const lightInk = inkFor(p.light, [p.dark, '#0a0a0a']);
  const hotOnLight = contrast(p.accent, p.light) >= 3 ? p.accent : mixHex(p.accent, '#000000', 0.35);
  const hotOnDark = contrast(p.accent, p.dark) >= 3 ? p.accent : mixHex(p.accent, '#ffffff', 0.35);
  const upper = d.tipografia.display.uppercase ? 'uppercase' : 'none';
  return `
:root{
  --dark:${p.dark};--light:${p.light};--accent:${p.accent};--accent2:${p.accent2};--primary:${p.primary};
  --surface:${surface};--surface2:${surface2};--soft:${soft};--soft-ink:${softInk};--light-ink:${lightInk};
  --accent-ink:${accentInk};--primary-ink:${primaryInk};--accent2-ink:${accent2Ink};
  --hot-light:${hotOnLight};--hot-dark:${hotOnDark};
  --font-display:${fontStack(d.tipografia.display.familia, 'display')};
  --font-text:${fontStack(d.tipografia.texto.familia, 'text')};
  --upper:${upper};
  --step-small:clamp(.8125rem,.79rem + .1vw,.875rem);--step-body:clamp(1.0625rem,1rem + .25vw,1.1875rem);
  --step-lead:clamp(1.25rem,1.1rem + .7vw,1.625rem);--step-head:clamp(2.6rem,1.2rem + 4.6vw,5.6rem);
  --step-display:clamp(3.6rem,.6rem + 10vw,10.5rem);--step-poster:clamp(2.6rem,.8rem + 5.6vw,6.5rem);
  --m:max(16px,min(2.8vw,44px));--gutter:clamp(12px,1.5vw,24px);--pad:clamp(72px,9vw,160px);--ease:cubic-bezier(.16,1,.3,1);
  color-scheme:dark;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--dark);color:var(--light);font-family:var(--font-text);font-size:var(--step-body);line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,svg{display:block;max-width:100%}
a{color:inherit;text-underline-offset:.18em}
p{margin:0;text-wrap:pretty}
p+p{margin-top:.9em}
h1,h2,h3,h4{margin:0;font-weight:400}
ul,ol{margin:0;padding:0;list-style:none}
button{font:inherit;color:inherit}
::selection{background:var(--accent);color:var(--accent-ink)}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.sr-only{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{padding-left:max(16px,var(--m));padding-right:max(16px,var(--m))}
.field{position:relative;padding-block:var(--pad);background:var(--bg);color:var(--ink)}
.f-dark{--bg:var(--dark);--ink:var(--light);--muted:color-mix(in srgb,var(--light) 62%,var(--dark));--hot:var(--hot-dark);--tile:var(--surface);--line:color-mix(in srgb,var(--light) 14%,transparent)}
.f-surface{--bg:var(--surface);--ink:var(--light);--muted:color-mix(in srgb,var(--light) 62%,var(--surface));--hot:var(--hot-dark);--tile:var(--surface2);--line:color-mix(in srgb,var(--light) 14%,transparent)}
.f-light{--bg:var(--light);--ink:var(--light-ink);--muted:color-mix(in srgb,var(--light-ink) 62%,var(--light));--hot:var(--hot-light);--tile:color-mix(in srgb,var(--light) 90%,var(--light-ink));--line:color-mix(in srgb,var(--light-ink) 14%,transparent)}
.f-soft{--bg:var(--soft);--ink:var(--soft-ink);--muted:color-mix(in srgb,var(--soft-ink) 65%,var(--soft));--hot:var(--hot-light);--tile:color-mix(in srgb,var(--soft) 88%,var(--soft-ink));--line:color-mix(in srgb,var(--soft-ink) 16%,transparent)}
.f-accent{--bg:var(--accent);--ink:var(--accent-ink);--muted:color-mix(in srgb,var(--accent-ink) 70%,var(--accent));--hot:var(--accent-ink);--tile:color-mix(in srgb,var(--accent) 85%,var(--accent-ink));--line:color-mix(in srgb,var(--accent-ink) 18%,transparent)}
.f-primary{--bg:var(--primary);--ink:var(--primary-ink);--muted:color-mix(in srgb,var(--primary-ink) 70%,var(--primary));--hot:var(--primary-ink);--tile:color-mix(in srgb,var(--primary) 85%,var(--primary-ink));--line:color-mix(in srgb,var(--primary-ink) 18%,transparent)}
.display,.head,.poster,.disp{font-family:var(--font-display);font-weight:600;text-transform:var(--upper);letter-spacing:.005em}
.display{font-size:var(--step-display);line-height:.9;text-wrap:balance}
.head{font-size:var(--step-head);line-height:.98;text-wrap:balance;margin-left:-.02em}
.poster{font-size:var(--step-poster);line-height:.95}
.lead{font-size:var(--step-lead);line-height:1.38;max-width:44ch}
.small{font-size:var(--step-small);line-height:1.45}
.muted{color:var(--muted)}
.hot{color:var(--hot)}
.measure{max-width:62ch}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}
.dot{display:inline-block;width:.36em;height:.36em;border-radius:50%;background:var(--accent);vertical-align:.06em;flex:none}
.kicker{font-size:var(--step-small);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
.sec-head{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--gutter);row-gap:24px;align-items:end;margin-bottom:clamp(44px,6vw,88px)}
.sec-head .head{grid-column:1/span 7}
.sec-head .intro{grid-column:8/span 5;max-width:46ch}
.btn{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 20px;border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-family:var(--font-text);font-weight:600;font-size:.95rem;text-decoration:none;cursor:pointer;transition:transform .35s var(--ease)}
.btn:hover{transform:translateY(-2px)}
.btn.ghost{background:transparent;color:inherit;border:1px solid var(--line,rgba(255,255,255,.2))}
.hairline{height:1px;background:var(--line);margin:40px 0}

/* logotipo tipográfico (quando o cliente ainda não enviou arquivo) */
.wm{display:inline-flex;flex-direction:column;line-height:.9;font-family:var(--font-display);font-weight:700;text-transform:var(--upper);letter-spacing:.01em}
.wm b{font-weight:inherit;font-size:1em;white-space:nowrap}
.wm i{display:inline-block;width:.22em;height:.22em;border-radius:50%;margin-left:.08em;vertical-align:0}
.wm small{font-family:var(--font-text);font-weight:600;font-size:.22em;letter-spacing:.3em;text-transform:uppercase;margin-top:.5em;opacity:.8}
.sym{display:inline-block;font-family:var(--font-display);font-weight:700;line-height:.9;text-transform:uppercase}
.sym i{display:inline-block;width:.22em;height:.22em;border-radius:50%;margin-left:.06em}
.logo-img{height:1em;width:auto;object-fit:contain}

/* barra */
.site-header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--dark) 90%,transparent);color:var(--light);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);transition:background-color .3s,color .3s}
.site-header[data-ink="light"]{background:color-mix(in srgb,var(--light) 92%,transparent);color:var(--light-ink)}
.site-header[data-ink="accent"]{background:color-mix(in srgb,var(--accent) 94%,transparent);color:var(--accent-ink)}
.site-header .bar{display:flex;align-items:center;gap:20px;min-height:64px}
.brand-link{text-decoration:none;flex:none;font-size:20px;display:flex;align-items:center}
.brand-link .wm{font-size:22px}.brand-link .logo-img{height:28px}
.nav{display:flex;gap:2px;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{padding:9px 11px;border-radius:999px;text-decoration:none;font-size:.9rem;font-weight:500;white-space:nowrap;transition:background-color .25s}
.nav a:hover,.nav a[aria-current="true"]{background:color-mix(in srgb,currentColor 12%,transparent)}
.site-header .btn{min-height:38px;padding:0 16px;font-size:.875rem;flex:none}
.example-banner{background:#b4530a;color:#fff;font-size:.85rem;padding:8px 0;text-align:center}

/* hero */
.hero{position:relative;min-height:min(92vh,980px);display:grid;align-content:end;padding:120px var(--m) 64px;overflow:hidden;isolation:isolate;background:var(--dark);color:var(--light)}
.hero::before{content:"";position:absolute;inset:-20% -10% auto;height:120%;background:radial-gradient(60% 55% at 72% 38%,color-mix(in srgb,var(--accent) 55%,transparent),transparent 70%);filter:blur(40px);opacity:.75;z-index:-1}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,var(--dark),transparent 55%);z-index:-1}
.hero__logo{font-size:clamp(44px,6vw,96px);margin-bottom:auto;position:absolute;top:96px;left:var(--m)}
.hero__logo .logo-img{height:1em}
.hero__meta{font-size:var(--step-small);color:color-mix(in srgb,var(--light) 70%,transparent);margin-bottom:28px}
.hero__headline{font-size:var(--step-display);line-height:.88;max-width:12ch}
.hero__under{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;margin-top:36px;max-width:1100px}
.hero__under p{max-width:52ch;font-size:var(--step-lead);line-height:1.35}

/* estratégia */
.cols-2{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--gutter);row-gap:40px}
.cols-2>.a{grid-column:1/span 6}.cols-2>.b{grid-column:8/span 5}
.statement{font-size:clamp(1.5rem,1rem + 1.8vw,2.6rem);line-height:1.22;font-weight:500;text-wrap:balance;max-width:28ch}
.list-h{font-family:var(--font-text);font-weight:600;font-size:var(--step-small);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.ticks li{position:relative;padding-left:22px;margin-top:8px}
.ticks li::before{content:"";position:absolute;left:0;top:.62em;width:10px;height:10px;border-radius:50%;background:var(--accent)}
.ticks.off li::before{background:transparent;border:2px solid var(--muted);width:8px;height:8px}
.manifesto__cols{columns:2;column-gap:48px;font-size:var(--step-lead);line-height:1.4;max-width:1100px}
.manifesto__cols p{break-inside:avoid;margin:0 0 1em}
.manifesto__cols strong{font-weight:600;color:var(--hot)}
.manifesto__sign{margin-top:40px;font-weight:600;display:flex;gap:10px;align-items:center}
.rows{display:grid;gap:0;border-top:1px solid var(--line)}
.row{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,8fr);gap:var(--gutter);padding:28px 0;border-bottom:1px solid var(--line)}
.row h3{font-family:var(--font-display);font-size:clamp(1.6rem,1rem + 1.8vw,2.6rem);text-transform:var(--upper);line-height:1}
.row p{font-size:var(--step-lead);line-height:1.35;max-width:50ch}
.poster-list{display:grid;gap:clamp(28px,4vw,56px)}
.poster-item{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:var(--gutter);align-items:end;border-top:1px solid var(--line);padding-top:24px}
.poster-item p{max-width:44ch;color:var(--muted)}
.poster-item .poster{color:var(--ink)}
.poster.poster--long{font-size:clamp(1.8rem,1rem + 3vw,3.6rem);line-height:1}
.diag-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px var(--gutter);margin-top:clamp(32px,4vw,56px)}
.diag-grid .ticks li{font-size:1rem;line-height:1.45}
.facts{display:grid;gap:0;border-top:1px solid var(--line)}
.facts div{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,8fr);gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
.facts dt{font-weight:600;color:var(--muted)}
.facts dd{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips li{padding:8px 14px;border-radius:999px;background:var(--tile);font-weight:500;font-size:.95rem}
.chips.off li{background:transparent;border:1px solid var(--line);text-decoration:line-through;text-decoration-color:var(--hot);color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--gutter)}
.tile{background:var(--tile);border-radius:24px;padding:28px;min-height:220px;display:flex;flex-direction:column;gap:10px}
.tile h3{font-family:var(--font-display);font-size:clamp(1.6rem,1.2rem + 1vw,2.2rem);text-transform:var(--upper);line-height:1}
.tile .role{color:var(--muted);font-weight:500;font-size:var(--step-small)}
.tile--accent{background:var(--accent);color:var(--accent-ink)}
.tile--accent .role{color:color-mix(in srgb,var(--accent-ink) 70%,transparent)}
.ends ul{border-top:1px solid var(--line)}
.ends li{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);font-size:var(--step-lead)}
.ends li span:last-child{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--hot)}
.ends .ends__head span{font-size:var(--step-small);letter-spacing:.12em;text-transform:uppercase;font-weight:600;text-decoration:none;color:var(--muted)}

/* logotipo */
.disc-stage{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(24px,4vw,64px);align-items:center;margin-bottom:clamp(40px,6vw,80px)}
.disc{aspect-ratio:1;max-width:620px;margin-inline:auto;border-radius:50%;background:var(--dark);color:var(--light);display:grid;place-items:center;padding:12%;font-size:clamp(28px,5vw,72px)}
.disc .logo-img{height:auto;width:100%;max-height:60%}
.meanings{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--gutter);row-gap:24px}
.meanings div{border-top:1px solid var(--line);padding-top:14px}
.meanings b{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}
.construct{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:var(--gutter);row-gap:32px;align-items:start}
.drawing{background:var(--tile);border-radius:24px;padding:clamp(28px,6vw,80px);display:grid;place-items:center}
.safe{position:relative;padding:1em;border:1.5px dashed color-mix(in srgb,var(--accent) 70%,transparent);font-size:clamp(28px,4.4vw,64px);display:inline-grid;place-items:center}
.safe .logo-img{height:1em}
.safe::after{content:"x";position:absolute;right:-1.6em;top:0;font-family:var(--font-text);font-size:.35em;color:var(--hot);font-weight:600}
.safe i.x{position:absolute;left:-.1em;top:-1.1em;width:.2em;height:.2em;font-size:.6em}
.ptable{width:100%;border-collapse:collapse}
.ptable td{padding:12px 0;border-bottom:1px solid var(--line);vertical-align:top}
.ptable td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.spec h3{font-weight:600;margin-bottom:10px;font-size:var(--step-lead)}
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--gutter)}
.wall figure{margin:0}
.wall .sq{aspect-ratio:1;border-radius:20px;display:grid;place-items:center;padding:14%;font-size:clamp(20px,2.4vw,34px);position:relative;overflow:hidden}
.wall .sq .logo-img{height:auto;width:100%;max-height:70%}
.wall figcaption{margin-top:10px;font-size:var(--step-small);color:var(--muted)}
.wall .no{position:absolute;left:12px;top:12px;width:28px;height:28px;border-radius:50%;background:#d12c0a;color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;line-height:1}
.wall-title{font-family:var(--font-display);font-size:clamp(1.8rem,1.2rem + 2vw,3rem);text-transform:var(--upper);margin:clamp(40px,6vw,72px) 0 20px}
.bad-stretch .wm,.bad-stretch .logo-img{transform:scaleX(1.5)}
.bad-squash .wm,.bad-squash .logo-img{transform:scaleY(.6)}
.bad-rotate .wm,.bad-rotate .logo-img{transform:rotate(-14deg)}
.bad-shadow .wm,.bad-shadow .logo-img{filter:drop-shadow(6px 8px 6px rgba(0,0,0,.6))}
.bad-outline .wm b{-webkit-text-stroke:2px currentColor;color:transparent}
.bad-box .wm,.bad-box .logo-img{outline:3px solid currentColor;outline-offset:10px}
.bad-photo{background-image:repeating-linear-gradient(135deg,#888 0 12px,#444 12px 24px)}
.bad-font .wm b{font-family:"Comic Sans MS","Chalkboard SE",cursive;text-transform:none;letter-spacing:0}

/* cores */
.sheets{display:grid;gap:12px}
.sheet{position:sticky;top:calc(72px + var(--i)*12px);background:var(--bg);color:var(--ink);border-radius:28px;padding:36px var(--m);min-height:min(52vh,460px);display:grid;grid-template-rows:auto 1fr;box-shadow:0 -10px 30px rgba(0,0,0,.18)}
.sheet__top{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
.sheet__name{font-family:var(--font-display);font-size:clamp(2.2rem,1.4rem + 3vw,4.6rem);text-transform:var(--upper);line-height:.95}
.sheet__use{font-weight:600;font-size:var(--step-small);letter-spacing:.1em;text-transform:uppercase;opacity:.8}
.sheet__body{display:grid;grid-template-columns:minmax(0,6fr) minmax(0,6fr);gap:var(--gutter);align-items:end;margin-top:24px}
.sheet__body p{max-width:46ch}
.codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px}
.codes span{display:block;font-size:var(--step-small);opacity:.75}
.codes b{font-variant-numeric:tabular-nums;font-size:1.15rem}
.copy-btn{border:1px solid currentColor;background:transparent;border-radius:999px;padding:6px 12px;font-size:.8rem;cursor:pointer;opacity:.85}
.prop-bar{display:flex;height:72px;border-radius:999px;overflow:hidden;margin-top:28px;border:1px solid var(--line)}
.prop-bar div{display:grid;place-items:center;font-size:.85rem;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden}

/* tipografia */
.specimen{font-family:var(--font-display);font-size:clamp(5rem,1rem + 15vw,16rem);line-height:.85;text-transform:var(--upper);word-break:break-word;margin:0 0 20px -.03em}
.alphabet{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(1.4rem,1rem + 1.6vw,2.6rem);line-height:1.15;letter-spacing:.04em;word-break:break-all;color:var(--muted)}
.type-notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--gutter);row-gap:28px;margin-top:40px}
.type-notes h3{font-weight:600;margin-bottom:8px}
.scale{width:100%;border-collapse:collapse;margin-top:12px}
.scale td{padding:18px 0;border-bottom:1px solid var(--line);vertical-align:middle}
.scale td:first-child{width:14ch;color:var(--muted);font-size:var(--step-small);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.scale td:last-child{width:12ch;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;font-size:var(--step-small)}
.s-display{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(2.6rem,2rem + 3vw,5rem);line-height:.9}
.s-head{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(1.8rem,1.4rem + 2vw,3.2rem);line-height:.95}
.s-sub{font-size:clamp(1.3rem,1.1rem + .8vw,1.8rem);font-weight:500;line-height:1.25}
.s-lead{font-size:var(--step-lead);line-height:1.35}
.s-body{font-size:var(--step-body)}
.s-small{font-size:var(--step-small);color:var(--muted)}
.text-specimen{font-size:clamp(1.3rem,1rem + 1.2vw,2rem);line-height:1.4;max-width:40ch;font-weight:500}

/* grafismo, imagem, movimento */
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:var(--gutter);row-gap:28px}
.rules div{border-top:1px solid var(--line);padding-top:14px}
.rules h3{font-weight:600;font-size:1.05rem;margin-bottom:6px}
.rules p{color:var(--muted);font-size:1rem}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--gutter);margin-top:40px}
.gallery figure{margin:0;border-radius:20px;overflow:hidden;background:var(--tile);aspect-ratio:3/2}
.gallery img{width:100%;height:100%;object-fit:cover}
.graphic-demo{height:clamp(220px,32vw,420px);border-radius:28px;background:var(--tile);position:relative;overflow:hidden;margin-bottom:40px;isolation:isolate}
.graphic-demo::before{content:"";position:absolute;inset:auto -10% -40% 40%;height:120%;background:radial-gradient(closest-side,var(--accent),transparent 70%);opacity:.9;filter:blur(30px)}
.graphic-demo .wm,.graphic-demo .logo-img{position:absolute;left:5%;bottom:10%;font-size:clamp(28px,5vw,72px)}
.graphic-demo .logo-img{height:clamp(32px,6vw,84px)}
.graphic-demo .bar{position:absolute;top:0;left:0;height:12px;width:38%;background:var(--accent)}

/* linguagem */
.tom-bars{display:grid;gap:18px;max-width:640px}
.tom-bars div{display:grid;grid-template-columns:8ch 1fr 8ch;align-items:center;gap:12px;font-size:var(--step-small);font-weight:600;color:var(--muted)}
.tom-bars div span:last-child{text-align:right}
.tom-bars i{position:relative;display:block;height:4px;border-radius:999px;background:var(--line)}
.tom-bars i::after{content:"";position:absolute;top:50%;left:var(--v);width:18px;height:18px;border-radius:50%;background:var(--accent);transform:translate(-50%,-50%)}
.principles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--gutter);row-gap:28px}
.principle{background:var(--tile);border-radius:24px;padding:26px;display:flex;flex-direction:column;gap:8px}
.principle h3{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(1.5rem,1.1rem + 1.2vw,2.2rem);line-height:1}
.principle .ex{margin-top:auto;padding-top:14px;border-top:1px solid var(--line);font-style:italic;color:var(--muted)}
.channel{width:100%;border-collapse:collapse}
.channel th{text-align:left;font-size:var(--step-small);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:0 0 12px;border-bottom:1px solid var(--line);font-weight:600}
.channel td{padding:16px 16px 16px 0;border-bottom:1px solid var(--line);vertical-align:top}
.channel td:first-child{font-weight:600;width:14ch}
.channel td:last-child{color:var(--muted);font-style:italic}
.scripts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--gutter);row-gap:24px}
.script{background:var(--tile);border-radius:20px;padding:22px}
.script h3{font-weight:600;font-size:var(--step-small);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.script blockquote{margin:0;font-size:1.05rem;line-height:1.45}
.sig-big{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(2.4rem,1.4rem + 4vw,5.5rem);line-height:.92}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:clamp(24px,4vw,64px)}

/* aplicações (mockups) */
.mocks{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:var(--gutter);row-gap:40px}
.mock{margin:0;display:flex;flex-direction:column;gap:10px;grid-column:span 4}
.mock figcaption{font-size:var(--step-small);color:var(--muted)}
.mock .frame{border-radius:18px;overflow:hidden;position:relative;background:var(--dark);color:var(--light);font-family:var(--font-text);box-shadow:0 20px 50px rgba(0,0,0,.25),0 0 0 1px color-mix(in srgb,var(--light) 12%,transparent)}
.mock .frame .disp{font-family:var(--font-display);text-transform:var(--upper);line-height:.92}
.m-post .frame{aspect-ratio:4/5;padding:7%;display:flex;flex-direction:column;justify-content:flex-end;gap:10px}
.m-post .frame .bar{position:absolute;top:0;left:0;height:4%;width:40%;background:var(--accent)}
.m-post .frame .disp{font-size:clamp(28px,3.4vw,52px)}
.m-post .frame .sup{font-size:clamp(11px,1vw,14px);color:color-mix(in srgb,var(--light) 70%,transparent)}
.m-post .frame .lg{position:absolute;top:7%;left:7%;font-size:clamp(14px,1.4vw,22px)}
.m-post .frame .lg .logo-img{height:1.3em}
.m-carousel .frame{aspect-ratio:4/5;background:var(--light);color:var(--light-ink);padding:7%;display:grid;grid-template-rows:auto 1fr auto}
.m-carousel .frame .num{font-family:var(--font-display);font-size:clamp(60px,9vw,150px);line-height:.85;color:var(--hot-light)}
.m-carousel .frame .disp{font-size:clamp(22px,2.6vw,40px);align-self:end}
.m-carousel .frame .foot{display:flex;justify-content:space-between;font-size:clamp(10px,.9vw,13px);color:color-mix(in srgb,var(--light-ink) 60%,transparent)}
.m-story{grid-column:span 3}
.m-story .frame{aspect-ratio:9/16;background:var(--accent);color:var(--accent-ink);padding:9% 8%;display:flex;flex-direction:column;justify-content:space-between}
.m-story .frame .disp{font-size:clamp(34px,4vw,64px)}
.m-story .frame .cta{align-self:flex-start;background:var(--accent-ink);color:var(--accent);border-radius:999px;padding:.6em 1.1em;font-weight:600;font-size:clamp(11px,1vw,14px)}
.m-story .frame .lg{font-size:clamp(13px,1.3vw,20px)}
.m-thumb{grid-column:span 6}
.m-thumb .frame{aspect-ratio:16/9;padding:5%;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(135deg,var(--surface2),var(--dark))}
.m-thumb .frame img.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}
.m-thumb .frame .disp{font-size:clamp(30px,4vw,64px);max-width:14ch;position:relative}
.m-thumb .frame .tag{position:absolute;top:6%;left:5%;background:var(--accent);color:var(--accent-ink);border-radius:999px;padding:.4em .9em;font-weight:600;font-size:clamp(10px,1vw,13px)}
.m-card{grid-column:span 6}
.m-card .cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.m-card .bc{aspect-ratio:1.75;border-radius:12px;padding:7%;display:flex;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.m-card .bc.front{background:var(--dark);color:var(--light);align-items:center;justify-content:center;font-size:clamp(18px,2vw,30px)}
.m-card .bc.back{background:var(--light);color:var(--light-ink);flex-direction:column;justify-content:flex-end;gap:2px;font-size:clamp(9px,.9vw,12px)}
.m-card .bc.back b{font-size:1.25em}
.m-email{grid-column:span 6}
.m-email .frame{background:#fff;color:#111;padding:6%;font-size:clamp(11px,1vw,14px);line-height:1.45;border:1px solid rgba(0,0,0,.08)}
.m-email .frame .sig{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;border-top:3px solid var(--accent);padding-top:12px;margin-top:10px}
.m-email .frame .sig .lg{font-size:clamp(14px,1.4vw,22px);color:var(--dark)}
.m-email .frame .sig .lg .logo-img{height:1.6em}
.m-proposal{grid-column:span 3}
.m-proposal .frame{aspect-ratio:210/297;background:var(--dark);padding:9%;display:flex;flex-direction:column;justify-content:space-between}
.m-proposal .frame .disp{font-size:clamp(20px,2.4vw,38px)}
.m-proposal .frame .meta{font-size:clamp(9px,.9vw,12px);color:color-mix(in srgb,var(--light) 65%,transparent)}
.m-proposal .frame .lg{font-size:clamp(13px,1.3vw,20px)}
.m-wa{grid-column:span 3}
.m-wa .frame{aspect-ratio:9/16;background:#e8e3dc;color:#111;padding:8% 7%;display:flex;flex-direction:column;gap:10px;font-size:clamp(10px,.95vw,13px)}
.m-wa .frame .hd{display:flex;align-items:center;gap:8px;font-weight:600;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,.1)}
.m-wa .frame .av{width:2.2em;height:2.2em;border-radius:50%;background:var(--dark);color:var(--light);display:grid;place-items:center;font-size:.9em}
.m-wa .frame .av .sym{font-size:1em}
.m-wa .frame .bub{background:#fff;border-radius:14px 14px 14px 4px;padding:10px 12px;max-width:88%;line-height:1.4}
.m-wa .frame .bub.me{background:#d9f3cf;border-radius:14px 14px 4px 14px;align-self:flex-end}
.m-sign{grid-column:span 12}
.m-sign .frame{aspect-ratio:21/6;background:var(--primary);color:var(--primary-ink);display:flex;align-items:center;justify-content:space-between;padding:4% 5%}
.m-sign .frame .lg{font-size:clamp(34px,6vw,110px);max-width:62%;overflow:hidden}
.m-sign .frame .lg .logo-img{height:1em}
.m-sign .frame .disp{font-size:clamp(16px,2.2vw,36px);text-align:right;max-width:18ch}
.m-reel{grid-column:span 3}
.m-reel .frame{aspect-ratio:9/16;padding:8%;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(180deg,var(--surface2),var(--dark))}
.m-reel .frame img.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.6}
.m-reel .frame .disp{font-size:clamp(26px,3vw,46px);position:relative}
.m-reel .frame .rec{position:absolute;top:7%;left:8%;display:flex;align-items:center;gap:6px;font-size:clamp(10px,.9vw,13px);font-weight:600;letter-spacing:.1em}
.m-reel .frame .rec i{width:.7em;height:.7em;border-radius:50%;background:#e5321f}
.app-rules{margin-top:48px}

/* manual e tokens */
.chapters{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--gutter);row-gap:28px}
.chapter{border-top:1px solid var(--line);padding-top:16px}
.chapter .n{font-size:var(--step-small);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.chapter h3{font-family:var(--font-display);text-transform:var(--upper);font-size:clamp(1.5rem,1.1rem + 1.4vw,2.4rem);line-height:1;margin:6px 0 10px}
pre.tokens{background:var(--tile);border-radius:20px;padding:22px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;line-height:1.55;margin:0}
details.skill{margin-top:24px}
details.skill summary{cursor:pointer;font-weight:600}
details.skill pre{margin-top:12px}

/* fechamento */
.close{padding:var(--pad) var(--m) 64px;background:var(--dark);color:var(--light);display:grid;gap:48px}
.close__logo{font-size:clamp(48px,10vw,160px)}
.close__logo .logo-img{height:1em;max-width:70vw}
.close__row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;border-top:1px solid color-mix(in srgb,var(--light) 14%,transparent);padding-top:24px;font-size:var(--step-small);color:color-mix(in srgb,var(--light) 70%,transparent)}
.close__row b{display:block;color:var(--light);margin-bottom:4px}

/* animação de entrada */
[data-rise]{opacity:0;transform:translateY(18px);transition:opacity .7s var(--ease),transform .9s var(--ease)}
[data-rise].in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){[data-rise]{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}}

@media (max-width:900px){
  .sec-head .head,.sec-head .intro{grid-column:1/-1}
  .cols-2>.a,.cols-2>.b{grid-column:1/-1}
  .manifesto__cols{columns:1}
  .row,.poster-item,.facts div,.sheet__body,.construct,.disc-stage{grid-template-columns:1fr}
  .hero__under{grid-template-columns:1fr}
  .hero__logo{position:static;margin-bottom:40px}
  .mock,.m-story,.m-thumb,.m-card,.m-email,.m-proposal,.m-wa,.m-reel{grid-column:span 6}
  .nav{display:none}
  .sheet{position:static;min-height:0}
}
@media (max-width:560px){.mock,.m-story,.m-thumb,.m-card,.m-email,.m-proposal,.m-wa,.m-reel,.m-sign{grid-column:span 12}}

/* impressão / PDF */
@page{size:1600px 1000px;margin:0}
@media print{
  html{font-size:14px}
  body{background:var(--dark)}
  .site-header,.example-banner,.copy-btn,.no-print{display:none!important}
  [data-rise]{opacity:1!important;transform:none!important;transition:none}
  .field,.hero,.close{break-before:page;break-inside:auto;page-break-before:always;min-height:1000px;padding:64px 64px}
  .hero{min-height:1000px;display:grid;align-content:end;padding-top:120px}
  .hero::before{filter:none;opacity:.5}
  .hero__logo{top:72px;left:64px}
  .sec-head{margin-bottom:40px}
  .hairline{margin:28px 0}
  .sheets{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .sheet{position:static;box-shadow:none;break-inside:avoid;min-height:0;padding:26px 36px}
  .sheet__body{margin-top:14px}
  .manifesto__cols{columns:2}
  .wall{grid-template-columns:repeat(6,1fr);gap:12px}
  .wall .sq{font-size:20px;border-radius:14px}
  .wall-title{margin:36px 0 16px}
  .principles{grid-template-columns:repeat(5,1fr);gap:12px}
  .principle{padding:18px}
  .rules{grid-template-columns:repeat(3,1fr)}
  .tiles{grid-template-columns:repeat(4,1fr)}
  .tile{min-height:0;padding:20px}
  .mocks{row-gap:24px}
  .mocks .mock{grid-column:span 3}
  .m-story,.m-reel,.m-proposal,.m-wa{grid-column:span 2}
  .m-thumb,.m-card,.m-email{grid-column:span 4}
  .m-sign{grid-column:span 12}
  .mock .frame{box-shadow:0 0 0 1px color-mix(in srgb,var(--light) 12%,transparent)}
  .gallery{grid-template-columns:repeat(4,1fr)}
  .chapters{grid-template-columns:repeat(3,1fr)}
  .tile,.principle,.script,.wall figure,.gallery figure,.poster-item,.row,.chapter,.meanings div,.rules div,.mock{break-inside:avoid}
  .sec-head,.wall-title,.list-h,h2,h3{break-after:avoid}
  a[href]::after{content:""}
}
`;
}

/* ------------------------------------------------------------------ */
/* JS                                                                   */
/* ------------------------------------------------------------------ */

function js(autoPrint: boolean) {
  return `
(function(){
  var header=document.querySelector('.site-header');
  var links=[].slice.call(document.querySelectorAll('.nav a'));
  var fields=[].slice.call(document.querySelectorAll('[data-chapter]'));
  function setCurrent(id){links.forEach(function(a){a.setAttribute('aria-current',a.getAttribute('href')==='#'+id?'true':'false')})}
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){header.setAttribute('data-ink',e.target.getAttribute('data-ink')||'dark');setCurrent(e.target.getAttribute('data-chapter'))}})},{rootMargin:'-45% 0px -50% 0px'});
    fields.forEach(function(f){io.observe(f)});
    var rise=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');rise.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'});
    [].slice.call(document.querySelectorAll('[data-rise]')).forEach(function(el){rise.observe(el)});
  } else {[].slice.call(document.querySelectorAll('[data-rise]')).forEach(function(el){el.classList.add('in')})}
  document.addEventListener('click',function(ev){var b=ev.target.closest('[data-copy]');if(!b)return;var v=b.getAttribute('data-copy');if(navigator.clipboard){navigator.clipboard.writeText(v).then(function(){var t=b.textContent;b.textContent='Copiado';setTimeout(function(){b.textContent=t},1200)})}});
  var pb=document.getElementById('btn-print');if(pb){pb.addEventListener('click',function(){window.print()})}
  window.addEventListener('beforeprint',function(){[].slice.call(document.querySelectorAll('[data-rise]')).forEach(function(el){el.classList.add('in')})});
  ${autoPrint ? "var ready=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();ready.then(function(){setTimeout(function(){window.print()},400)});" : ''}
})();`;
}

/* ------------------------------------------------------------------ */
/* Seções                                                               */
/* ------------------------------------------------------------------ */

function header(d: BrandbookData, opts: RenderOptions) {
  const chapters = [
    ['estrategia', 'Estratégia'],
    ['logotipo', 'Logotipo'],
    ['cores', 'Cores'],
    ['tipografia', 'Tipografia'],
    ['grafismo', 'Grafismo'],
    ['linguagem', 'Linguagem'],
    ['aplicacoes', 'Aplicações'],
    ['manual', 'Manual'],
  ];
  const acts = [
    opts.actions?.html ? `<a class="btn ghost no-print" href="${attr(opts.actions.html)}" download>Baixar HTML</a>` : '',
    `<button class="btn no-print" id="btn-print" type="button">${opts.actions?.pdf ? 'Salvar PDF' : 'Imprimir / PDF'}</button>`,
  ].join('');
  return `<header class="site-header" data-ink="dark">
  <div class="wrap bar">
    <a class="brand-link" href="#topo" aria-label="${attr(d.meta.brand)}, início">${logoMark(d, { size: '24px' })}</a>
    <nav class="nav" aria-label="Capítulos">${chapters.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>
    ${acts}
  </div>
</header>`;
}

function hero(d: BrandbookData) {
  return `<section class="hero" id="topo" data-ink="dark" data-chapter="estrategia" aria-labelledby="hero-title">
  <div class="hero__logo">${logoMark(d, { color: 'var(--light)' })}</div>
  <p class="hero__meta">${esc(d.hero.kicker)}</p>
  <h1 class="hero__headline display" id="hero-title">${esc(d.hero.headline)}</h1>
  <div class="hero__under">
    <p>${esc(d.hero.sub)}</p>
    <a class="btn" href="#manifesto">Ler o manifesto</a>
  </div>
</section>`;
}

function diagnostico(d: BrandbookData) {
  const g = d.diagnostico;
  const block = (t: string, items: string[], off = false) => (items.length ? `<div><div class="list-h">${t}</div><ul class="ticks${off ? ' off' : ''}">${li(items)}</ul></div>` : '');
  return `<section class="field f-dark" data-ink="dark" data-chapter="estrategia" id="estrategia" aria-labelledby="t-ponto">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-ponto" data-rise>O ponto de partida</h2><p class="intro muted">Como a marca é vista hoje, o que já funciona e o que precisa mudar. É daqui que o resto do manual parte.</p></div>
    <p class="${g.percepcao.length > 230 ? 'lead' : 'statement'}" style="${g.percepcao.length > 230 ? 'max-width:64ch' : ''}" data-rise>${esc(g.percepcao)}</p>
    <div class="diag-grid" data-rise>
      ${block('Pontos fortes', g.fortes)}
      ${block('Incoerências de hoje', g.incoerencias, true)}
      ${block('Territórios já ocupados pelos concorrentes', g.territorios, true)}
      ${block('Oportunidades', g.oportunidades)}
    </div>
  </div>
</section>`;
}

function manifesto(d: BrandbookData) {
  const paras = d.manifesto.map((p) => {
    // destaca a parte final da frase quando há dois pontos
    const i = p.indexOf(':');
    if (i > 0 && i < p.length - 2) return `<p>${esc(p.slice(0, i + 1))} <strong>${esc(p.slice(i + 1).trim())}</strong></p>`;
    return `<p>${esc(p)}</p>`;
  });
  return `<section class="field f-light" data-ink="light" data-chapter="estrategia" id="manifesto" aria-labelledby="t-manifesto">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-manifesto" data-rise>Manifesto</h2><p class="intro muted">O texto que explica por que a marca existe. Inteiro no site e no filme; em trechos, nos posts, propostas e apresentações.</p></div>
    <div class="manifesto__cols" data-rise>${paras.join('')}</div>
    <p class="manifesto__sign"><span class="dot"></span> ${esc(d.meta.brand)}. ${esc(d.linguagem.assinatura)}</p>
  </div>
</section>`;
}

function pmv(d: BrandbookData) {
  return `<section class="field f-accent" data-ink="accent" data-chapter="estrategia" aria-labelledby="t-pmv">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-pmv" data-rise>Propósito, missão, visão</h2><p class="intro">Três frases que orientam decisões: o que aceitar, o que recusar e onde investir.</p></div>
    <div class="rows" data-rise>
      <div class="row"><h3>Propósito</h3><p>${esc(d.pmv.proposito)}</p></div>
      <div class="row"><h3>Missão</h3><p>${esc(d.pmv.missao)}</p></div>
      <div class="row"><h3>Visão</h3><p>${esc(d.pmv.visao)}</p></div>
    </div>
  </div>
</section>`;
}

function valores(d: BrandbookData) {
  return `<section class="field f-dark" data-ink="dark" data-chapter="estrategia" aria-labelledby="t-valores">
  <div class="wrap poster-list">
    <div class="poster-item" style="border-top:0;padding-top:0"><h2 class="poster" id="t-valores">Valores</h2><p>Cada valor vem com o comportamento que o torna verdadeiro. Se não dá para ver no dia a dia, não é valor.</p></div>
    ${d.valores.map((v) => `<div class="poster-item" data-rise><h3 class="poster${v.titulo.length > 26 ? ' poster--long' : ''}">${esc(v.titulo)}</h3><p>${esc(v.texto)}</p></div>`).join('')}
  </div>
</section>`;
}

function posicionamento(d: BrandbookData) {
  const p = d.posicionamento;
  return `<section class="field f-soft" data-ink="light" data-chapter="estrategia" aria-labelledby="t-posicionamento">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-posicionamento" data-rise>Posicionamento</h2></div>
    <div class="cols-2">
      <div class="a"><p class="statement" data-rise>${esc(p.statement)}</p>${p.pilares.length ? `<div style="margin-top:32px" data-rise><div class="list-h">Pilares de mensagem</div><ul class="chips">${li(p.pilares)}</ul></div>` : ''}</div>
      <dl class="facts b" data-rise>
        <div><dt>Categoria</dt><dd>${esc(p.categoria)}</dd></div>
        <div><dt>Território</dt><dd>${esc(p.territorio)}</dd></div>
        <div><dt>Proposta de valor</dt><dd>${esc(p.proposta_valor)}</dd></div>
        <div><dt>Prova</dt><dd>${esc(p.prova)}</dd></div>
        <div><dt>Contra quem</dt><dd>${esc(p.contraponto)}</dd></div>
      </dl>
    </div>
  </div>
</section>`;
}

function publico(d: BrandbookData) {
  const tiles = d.publico.personas.map((p, i) => `<div class="tile${i === 0 ? ' tile--accent' : ''}" data-rise><h3>${esc(p.nome)}</h3>${p.papel ? `<div class="role">${esc(p.papel)}</div>` : ''}<p><b>Dor:</b> ${esc(p.dor)}</p><p><b>Deseja:</b> ${esc(p.desejo)}</p></div>`).join('');
  return `<section class="field f-surface" data-ink="dark" data-chapter="estrategia" aria-labelledby="t-publico">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-publico" data-rise>Para quem</h2><p class="intro muted">${esc(d.publico.descricao)}</p></div>
    ${tiles ? `<div class="tiles">${tiles}</div><p class="small muted" style="margin-top:16px">Personas de referência, criadas para orientar linguagem e oferta. Não representam clientes reais.</p>` : ''}
  </div>
</section>`;
}

function personalidade(d: BrandbookData) {
  const pares = d.personalidade.pares.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  return `<section class="field f-light" data-ink="light" data-chapter="estrategia" aria-labelledby="t-personalidade">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-personalidade" data-rise>Personalidade</h2><p class="intro muted">Arquétipo principal: <strong>${esc(d.personalidade.arquetipo)}</strong>.</p></div>
    <div class="cols-2">
      <div class="a"><p class="statement" data-rise>${esc(d.personalidade.statement)}</p></div>
      <div class="b ends" data-rise><ul><li class="ends__head"><span>Somos</span><span>Não somos</span></li>${pares}</ul></div>
    </div>
  </div>
</section>`;
}

function logotipo(d: BrandbookData) {
  const meanings = d.simbolo.significados.map((m) => `<div><b><span class="dot"></span>${esc(m.titulo)}</b>${esc(m.texto)}</div>`).join('');
  return `<section class="field f-light" data-ink="light" data-chapter="logotipo" id="logotipo" aria-labelledby="t-logo">
  <div class="wrap">
    <div class="disc-stage">
      <div data-rise>
        <h2 class="head" id="t-logo">Logotipo</h2>
        <p class="lead" style="margin-top:20px">${esc(d.simbolo.conceito)}</p>
        <p class="muted" style="margin-top:16px">${d.logo.src ? 'Os arquivos em SVG e PNG (principal, vertical, símbolo e versões monocromáticas) acompanham este manual.' : 'Este é o logotipo tipográfico de trabalho. O arquivo final em vetor, com todas as versões, acompanha a entrega da identidade.'}</p>
      </div>
      <div class="disc" aria-hidden="true">${logoMark(d, { color: 'var(--light)' })}</div>
    </div>
    <div class="meanings" data-rise>${meanings}</div>
  </div>
</section>`;
}

function construcao(d: BrandbookData) {
  const rows = d.construcao.tamanhos.map((t) => `<tr><td>${esc(t.versao)}</td><td>${esc(t.valor)}</td></tr>`).join('');
  return `<section class="field f-surface" data-ink="dark" data-chapter="logotipo" aria-labelledby="t-construcao">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-construcao" data-rise>Construção e respiro</h2><p class="intro muted">${esc(d.construcao.area_protecao)}</p></div>
    <div class="construct" data-rise>
      <figure class="drawing" style="margin:0"><div class="safe">${logoMark(d, { color: 'var(--light)' })}</div></figure>
      <div class="spec"><h3>Tamanho mínimo</h3><table class="ptable small"><tbody>${rows}</tbody></table><p class="small muted" style="margin-top:16px">Abaixo do tamanho mínimo, use só o símbolo. Em vídeo, respeite a zona segura de 9:16 (14% no topo, 35% na base).</p></div>
    </div>
  </div>
</section>`;
}

function versoes(d: BrandbookData) {
  const p = d.palette;
  const bgs: { bg: string; label: string; mono?: boolean }[] = [
    { bg: p.dark, label: 'Principal sobre fundo escuro' },
    { bg: p.light, label: 'Principal sobre fundo claro' },
    { bg: p.accent, label: 'Sobre a cor de destaque', mono: true },
    { bg: p.primary, label: 'Sobre a cor principal', mono: true },
    { bg: p.surface, label: 'Monocromática clara', mono: true },
    { bg: p.light, label: 'Monocromática escura', mono: true },
  ];
  const wall = bgs
    .map((b) => {
      const ink = inkFor(b.bg, [p.dark, p.light, '#0a0a0a', '#ffffff']);
      return `<figure><div class="sq" style="background:${b.bg};color:${ink}">${logoMark(d, { color: ink, mono: b.mono, dot: b.mono ? ink : p.accent })}</div><figcaption>${esc(b.label)}</figcaption></figure>`;
    })
    .join('');
  const symbol = `<figure><div class="sq" style="background:${p.dark};color:${p.light};font-size:clamp(44px,5vw,80px)">${symbolMark(d, p.light, p.accent)}</div><figcaption>Símbolo isolado (avatar, favicon, selo)</figcaption></figure>`;
  const badKinds = ['bad-stretch', 'bad-squash', 'bad-rotate', 'bad-shadow', 'bad-outline', 'bad-box', 'bad-photo', 'bad-font'];
  const bad = d.usos_incorretos
    .map((u, i) => {
      const k = badKinds[i % badKinds.length];
      const dark = i % 2 === 0;
      const bg = k === 'bad-photo' ? '' : `background:${dark ? p.dark : p.light};`;
      const ink = dark || k === 'bad-photo' ? p.light : p.dark;
      const lowContrast = k === 'bad-photo';
      return `<figure class="${k}"><div class="sq" style="${bg}color:${lowContrast ? mixHex(p.light, '#888888', 0.3) : ink}"><span class="no" aria-hidden="true">×</span>${logoMark(d, { color: lowContrast ? mixHex(p.light, '#888888', 0.3) : ink, dot: k === 'bad-outline' ? 'transparent' : undefined })}</div><figcaption>${esc(u)}</figcaption></figure>`;
    })
    .join('');
  return `<section class="field f-soft" data-ink="light" data-chapter="logotipo" aria-labelledby="t-versoes">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-versoes" data-rise>Versões</h2><p class="intro muted">Preferência: o logotipo sobre o fundo escuro da marca. Sobre a cor de destaque, versão monocromática. Nunca recolorir fora da paleta.</p></div>
    <div class="wall" data-rise>${wall}${symbol}</div>
    <h3 class="wall-title" data-rise>Usos incorretos</h3>
    <div class="wall" data-rise>${bad}</div>
  </div>
</section>`;
}

function cores(d: BrandbookData) {
  const sheets = d.cores
    .map(
      (c: Swatch, i: number) => `<article class="sheet" style="--i:${i};--bg:${c.hex};--ink:${c.ink}">
      <div class="sheet__top"><h3 class="sheet__name">${esc(c.name)}</h3><span class="sheet__use">${esc(c.share === 'apoio' ? 'Apoio funcional' : `${c.share} da composição`)}</span></div>
      <div class="sheet__body">
        <p>${esc(c.use)}</p>
        <div class="codes">
          <div><span>HEX</span><b>${esc(c.hex)}</b></div><div><span>RGB</span><b>${esc(c.rgb)}</b></div>
          <div><span>CMYK (aprox.)</span><b>${esc(c.cmyk)}</b></div><div><button class="copy-btn" type="button" data-copy="${attr(c.hex)}">Copiar HEX</button></div>
        </div>
      </div>
    </article>`,
    )
    .join('');
  const bar = d.proporcao.map((x) => `<div style="flex:${x.share};background:${x.hex};color:${x.ink}" title="${attr(x.name)} ${x.share}%">${x.share >= 12 ? `${esc(x.name)} ${x.share}%` : `${x.share}%`}</div>`).join('');
  return `<section class="field f-surface" data-ink="dark" data-chapter="cores" id="cores" aria-labelledby="t-cores">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-cores" data-rise>Cores</h2><p class="intro muted">Uma cor escura dá o palco, uma clara dá o respiro e a cor de destaque marca a ação. Ela aparece pouco e sempre onde importa.</p></div>
    <div class="sheets">${sheets}</div>
    <h3 class="wall-title" data-rise>Proporção</h3>
    <div class="prop-bar" data-rise>${bar}</div>
    <p class="small muted" style="margin-top:14px">Texto sobre cor precisa de contraste mínimo de 4,5 para 1. Nunca texto em cor de destaque sobre a cor principal.</p>
  </div>
</section>`;
}

function tipografia(d: BrandbookData) {
  const t = d.tipografia;
  const scale = t.escala
    .map((r) => {
      const cls = { Display: 's-display', Título: 's-head', Subtítulo: 's-sub', Lead: 's-lead', Texto: 's-body', Legenda: 's-small' }[r.nome] || 's-body';
      return `<tr><td>${esc(r.nome)} · ${esc(r.font === 'display' ? t.display.familia : t.texto.familia)}</td><td><span class="${cls}">${esc(r.exemplo)}</span></td><td>${esc(r.tamanho)}</td></tr>`;
    })
    .join('');
  return `<section class="field f-accent" data-ink="accent" data-chapter="tipografia" id="tipografia" aria-labelledby="t-disp">
  <div class="wrap">
    <p class="kicker" style="color:var(--muted)">Fonte de título</p>
    <h2 class="specimen" id="t-disp" data-rise>${esc(t.display.familia)}</h2>
    <p class="alphabet" data-rise>ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</p>
    <div class="type-notes" data-rise>
      <div><h3>Para que serve</h3><p>${esc(t.display.para_que)}</p></div>
      <div><h3>Como compor</h3><p>${esc(t.display.como_compor)}</p></div>
      <div><h3>Cuidados</h3><p>${esc(t.display.cuidados)} Licença: ${esc(t.display.licenca)}.</p></div>
    </div>
  </div>
</section>
<section class="field f-light" data-ink="light" data-chapter="tipografia" aria-labelledby="t-texto">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-texto" data-rise>Texto e escala</h2><p class="intro muted">${esc(t.texto.familia)} faz todo o resto: ${esc(t.texto.para_que.toLowerCase())} Licença: ${esc(t.texto.licenca)}.</p></div>
    <div class="two">
      <p class="text-specimen" data-rise>${esc(d.posicionamento.proposta_valor)} ${esc(t.texto.escala)}</p>
      <table class="scale" data-rise><tbody>${scale}</tbody></table>
    </div>
  </div>
</section>`;
}

function grafismo(d: BrandbookData) {
  const rules = d.grafismo.regras.map((r) => `<div><h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p></div>`).join('');
  const moods = d.moodboards.map((m) => `<figure><img src="${attr(m.src)}" alt="${attr(m.alt)}" loading="lazy"></figure>`).join('');
  const fotos = d.fotos.map((m) => `<figure><img src="${attr(m.src)}" alt="${attr(m.alt)}" loading="lazy"></figure>`).join('');
  const img = d.fotografia.map((r) => `<div><h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p></div>`).join('');
  const mov = d.movimento.map((r) => `<div><h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p></div>`).join('');
  return `<section class="field f-dark" data-ink="dark" data-chapter="grafismo" id="grafismo" aria-labelledby="t-grafismo">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-grafismo" data-rise>${esc(d.grafismo.titulo)}</h2><p class="intro muted">${esc(d.grafismo.descricao)}</p></div>
    <div class="graphic-demo" data-rise aria-hidden="true"><div class="bar"></div>${logoMark(d, { color: 'var(--light)' })}</div>
    <div class="rules" data-rise>${rules}</div>
    ${moods ? `<h3 class="wall-title" data-rise>Moodboard</h3><div class="gallery" style="margin-top:0" data-rise>${moods}</div>` : ''}
  </div>
</section>
<section class="field f-soft" data-ink="light" data-chapter="grafismo" aria-labelledby="t-imagem">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-imagem" data-rise>Imagem e movimento</h2><p class="intro muted">Foto e vídeo são metade da identidade. Material real da marca acima de banco de imagem ou gerado.</p></div>
    <h3 class="list-h">Fotografia</h3>
    <div class="rules" data-rise>${img}</div>
    <h3 class="list-h" style="margin-top:48px">Movimento</h3>
    <div class="rules" data-rise>${mov}</div>
    ${fotos ? `<div class="gallery" data-rise>${fotos}</div>` : ''}
  </div>
</section>`;
}

function linguagem(d: BrandbookData) {
  const L = d.linguagem;
  const bars = L.tom.map((t) => `<div><span>${esc(t.a)}</span><i style="--v:${t.valor}%"></i><span>${esc(t.b)}</span></div>`).join('');
  const principles = L.principios.map((p) => `<article class="principle" data-rise><h3>${esc(p.titulo)}</h3><p class="muted">${esc(p.texto)}</p>${p.exemplo ? `<p class="ex">“${esc(p.exemplo)}”</p>` : ''}</article>`).join('');
  const channel = L.tom_por_canal.map((c) => `<tr><td>${esc(c.canal)}</td><td>${esc(c.tom)}</td><td>${esc(c.exemplo)}</td></tr>`).join('');
  const scripts = [
    ...L.ctas.map((c) => `<div class="script"><h3>Chamada · ${esc(c.objetivo)}</h3><blockquote>${esc(c.texto)}</blockquote></div>`),
    ...L.bordoes.map((b) => `<div class="script"><h3>Bordão</h3><blockquote>${esc(b)}</blockquote></div>`),
  ].join('');
  const fala = L.fala_assim.length || L.nao_fala_assim.length
    ? `<div class="two" style="margin-top:56px" data-rise>
        <div><div class="list-h">Fala assim</div><ul class="ticks">${li(L.fala_assim)}</ul></div>
        <div><div class="list-h">Não fala assim</div><ul class="ticks off">${li(L.nao_fala_assim)}</ul></div>
      </div>`
    : '';
  return `<section class="field f-dark" data-ink="dark" data-chapter="linguagem" id="linguagem" aria-labelledby="t-linguagem">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-linguagem" data-rise>Linguagem</h2><p class="intro muted">${esc(L.descricao_tom)}</p></div>
    <div class="tom-bars" data-rise>${bars}</div>
    <div class="hairline"></div>
    <div class="principles">${principles}</div>
  </div>
</section>
<section class="field f-light" data-ink="light" data-chapter="linguagem" aria-labelledby="t-tom">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-tom" data-rise>Tom por canal</h2><p class="intro muted">A voz é a mesma; o tom muda com o lugar, a pressa e quem lê.</p></div>
    <table class="channel" data-rise><thead><tr><th>Canal</th><th>Tom</th><th>Exemplo</th></tr></thead><tbody>${channel}</tbody></table>
    <div class="two" style="margin-top:56px" data-rise>
      <div><div class="list-h">Usar</div><ul class="chips">${li(L.usar.length ? L.usar : ['prova', 'prazo', 'processo'])}</ul></div>
      <div><div class="list-h">Evitar</div><ul class="chips off">${li(L.evitar.length ? L.evitar : ['melhor', 'incrível', 'top'])}</ul></div>
    </div>
    ${fala}
    ${scripts ? `<div class="hairline"></div><div class="scripts" data-rise>${scripts}</div>` : ''}
    <div class="hairline"></div>
    <div class="two" data-rise>
      <div><div class="list-h">Assinatura</div><p class="sig-big">${esc(L.assinatura)}</p>${L.linha_campanha ? `<p class="muted" style="margin-top:14px">Linha de campanha: <b>${esc(L.linha_campanha)}</b></p>` : ''}</div>
      <div><div class="list-h">Grafia</div><p>${esc(L.grafia)}</p></div>
    </div>
  </div>
</section>`;
}

function findApp(d: BrandbookData, re: RegExp, fallback: string, descFallback = '') {
  const it = d.aplicacoes.itens.find((x) => re.test(x.peca));
  return { texto: it?.texto || fallback, descricao: it?.descricao || descFallback };
}

function aplicacoes(d: BrandbookData) {
  const p = d.palette;
  const name = d.meta.brand;
  const sig = d.linguagem.assinatura;
  const post = findApp(d, /post|4:5/i, sig, 'Post 4:5 com gancho em até 12 palavras.');
  const car = findApp(d, /carross/i, d.linguagem.principios[0]?.titulo || 'Card 2 funciona sozinho', 'Capa, cards numerados e card final só com a chamada.');
  const story = findApp(d, /story|stories/i, d.linguagem.bordoes[0] || 'Última semana.', 'Texto grande no centro e chamada na base.');
  const reel = findApp(d, /reel/i, d.posicionamento.pilares[0] || 'Veja como é feito', 'Capa de Reel: rosto em primeiro plano e título em duas linhas.');
  const thumb = findApp(d, /thumb|16:9|youtube/i, d.linguagem.linha_campanha || sig, 'Thumbnail 16:9: título grande, selo e foto real.');
  const card = findApp(d, /cart[aã]o/i, d.meta.client || name, 'Cartão de visita 9 × 5 cm.');
  const mail = findApp(d, /e-?mail|assinatura/i, d.meta.client || name, 'Assinatura de e-mail.');
  const prop = findApp(d, /propost/i, `Proposta para ${d.meta.client || 'o cliente'}`, 'Proposta comercial: capa escura, páginas claras.');
  const sign = findApp(d, /fachada|banner|uniforme|outdoor/i, sig, 'Fachada, banner ou uniforme.');
  const wa = findApp(d, /whats/i, `Oi, [nome]! Aqui é da ${name}. Me conta o que você precisa e te passo o caminho.`, 'Primeira resposta no WhatsApp.');
  const foto = d.fotos[0]?.src || d.moodboards[0]?.src || '';
  const lg = (color: string) => logoMark(d, { color });
  const mocks = `
    <figure class="mock m-post"><div class="frame"><div class="bar"></div><div class="lg">${lg(p.light)}</div><div class="disp">${esc(post.texto)}</div><div class="sup">${esc(d.posicionamento.statement)}</div></div><figcaption><b>Post 4:5.</b> ${esc(post.descricao)}</figcaption></figure>
    <figure class="mock m-carousel"><div class="frame"><div class="num">02</div><div class="disp">${esc(car.texto)}</div><div class="foot"><span>${esc(name)}</span><span>2 / 8</span></div></div><figcaption><b>Carrossel.</b> ${esc(car.descricao)}</figcaption></figure>
    <figure class="mock m-story"><div class="frame"><div class="lg">${lg(p.accent === d.palette.accent ? 'var(--accent-ink)' : p.dark)}</div><div class="disp">${esc(story.texto)}</div><div class="cta">${esc(d.linguagem.ctas[0]?.texto || 'Chame no WhatsApp')}</div></div><figcaption><b>Story 9:16.</b> ${esc(story.descricao)}</figcaption></figure>
    <figure class="mock m-reel"><div class="frame">${foto ? `<img class="ph" src="${attr(foto)}" alt="">` : ''}<div class="rec"><i></i>REC</div><div class="disp">${esc(reel.texto)}</div></div><figcaption><b>Capa de Reel.</b> ${esc(reel.descricao)}</figcaption></figure>
    <figure class="mock m-thumb"><div class="frame">${foto ? `<img class="ph" src="${attr(foto)}" alt="">` : ''}<div class="tag">${esc(name)}</div><div class="disp">${esc(thumb.texto)}</div></div><figcaption><b>Thumbnail 16:9.</b> ${esc(thumb.descricao)}</figcaption></figure>
    <figure class="mock m-card"><div class="cards"><div class="bc front">${lg(p.light)}</div><div class="bc back"><b>${esc(card.texto)}</b><span>${esc(d.meta.segment)}</span><span>${esc(d.meta.whatsapp || '(34) 9 0000-0000')}</span><span>${esc(d.meta.instagram ? d.meta.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '') : d.meta.website || '')}</span></div></div><figcaption><b>Cartão de visita.</b> ${esc(card.descricao)}</figcaption></figure>
    <figure class="mock m-email"><div class="frame"><p>Oi, [nome]. Segue a proposta combinada na reunião. Qualquer dúvida, me chama aqui ou no WhatsApp.</p><div class="sig"><div class="lg">${lg(p.dark)}</div><div><b>${esc(mail.texto)}</b><br>${esc(name)} · ${esc(d.meta.whatsapp || 'WhatsApp')}<br>${esc(d.meta.website || d.meta.instagram || d.meta.city)}</div></div></div><figcaption><b>Assinatura de e-mail.</b> ${esc(mail.descricao)}</figcaption></figure>
    <figure class="mock m-proposal"><div class="frame"><div class="lg">${lg(p.light)}</div><div><div class="disp">${esc(prop.texto)}</div><div class="meta" style="margin-top:10px">${esc(d.meta.date)} · versão 1</div></div></div><figcaption><b>Proposta.</b> ${esc(prop.descricao)}</figcaption></figure>
    <figure class="mock m-wa"><div class="frame"><div class="hd"><span class="av">${symbolMark(d, p.light, p.accent)}</span>${esc(name)}</div><div class="bub">${esc(wa.texto)}</div><div class="bub me">Quero saber de ${esc(d.meta.segment.toLowerCase())}.</div><div class="bub">Perfeito. Em 1 hora útil te mando o próximo passo.</div></div><figcaption><b>WhatsApp.</b> ${esc(wa.descricao)}</figcaption></figure>
    <figure class="mock m-sign"><div class="frame"><div class="lg">${logoMark(d, { color: 'var(--primary-ink)', mono: contrast(p.accent, p.primary) < 3 })}</div><div class="disp">${esc(sign.texto)}</div></div><figcaption><b>Fachada / banner.</b> ${esc(sign.descricao)}</figcaption></figure>`;
  const rules = d.aplicacoes.regras.length ? `<div class="app-rules" data-rise><div class="list-h">Regras de uso</div><ul class="ticks">${li(d.aplicacoes.regras)}</ul></div>` : '';
  return `<section class="field f-dark" data-ink="dark" data-chapter="aplicacoes" id="aplicacoes" aria-labelledby="t-aplicacoes">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-aplicacoes" data-rise>Aplicações</h2><p class="intro muted">${esc(d.aplicacoes.intro)}</p></div>
    <div class="mocks" data-rise>${mocks}</div>
    ${rules}
  </div>
</section>`;
}

function manualSec(d: BrandbookData) {
  const caps = d.manual.capitulos.map((c, i) => `<div class="chapter" data-rise><div class="n">Capítulo ${i + 1}</div><h3>${esc(c.titulo)}</h3><p class="muted">${nl2(c.texto)}</p></div>`).join('');
  const cssVars = Object.entries(d.tokens)
    .map(([k, v]) => `  --${k.replace(/_/g, '-')}: ${v};`)
    .join('\n');
  const json = JSON.stringify({ marca: d.meta.brand, versao: d.meta.version, tokens: d.tokens, cores: Object.fromEntries(d.cores.map((c) => [c.key, c.hex])), fontes: { display: d.tipografia.display.familia, texto: d.tipografia.texto.familia } }, null, 2);
  return `<section class="field f-light" data-ink="light" data-chapter="manual" id="manual" aria-labelledby="t-manual">
  <div class="wrap">
    <div class="sec-head"><h2 class="head" id="t-manual" data-rise>Regras rápidas</h2><p class="intro muted">O resumo para quem vai produzir uma peça amanhã cedo. Os tokens abaixo alimentam o site, o feed, os vídeos e os agentes.</p></div>
    ${caps ? `<div class="chapters">${caps}</div><div class="hairline"></div>` : ''}
    <div class="two" data-rise>
      <div><div class="list-h">Tokens (CSS)</div><pre class="tokens">:root {\n${esc(cssVars)}\n}</pre></div>
      <div><div class="list-h">Tokens (JSON)</div><pre class="tokens">${esc(json)}</pre></div>
    </div>
    ${d.skill_md ? `<details class="skill" data-rise><summary>SKILL.md para os agentes de criação</summary><pre class="tokens">${esc(d.skill_md)}</pre></details>` : ''}
  </div>
</section>`;
}

function closeSec(d: BrandbookData) {
  const st = d.meta.studio;
  return `<section class="close" data-ink="dark" data-chapter="manual" aria-labelledby="t-close">
  <h2 class="sr-only" id="t-close">${esc(d.meta.brand)}</h2>
  <div class="close__logo">${logoMark(d, { color: 'var(--light)' })}</div>
  <p class="lead">${esc(d.fechamento)}</p>
  <div class="close__row">
    <div><b>${esc(d.meta.brand)}</b>${esc(d.meta.city)}${d.meta.whatsapp ? `<br>${esc(d.meta.whatsapp)}` : ''}${d.meta.website ? `<br>${esc(d.meta.website)}` : ''}</div>
    <div><b>Manual de marca</b>Versão ${d.meta.version}.0 · ${esc(d.meta.date)}<br>${esc(d.meta.mode === 'zero' ? 'Branding do zero' : d.meta.mode === 'rebranding' ? 'Rebranding' : d.meta.mode === 'refresh' ? 'Refresh' : 'Marca importada')}</div>
    <div><b>Feito por ${esc(st.name)}</b>${esc(st.city)} · ${esc(st.instagram)}<br>${esc(st.site)} · ${esc(st.whatsapp)}</div>
  </div>
</section>`;
}

/* ------------------------------------------------------------------ */
/* Documento                                                            */
/* ------------------------------------------------------------------ */

export function renderBrandbookHTML(d: BrandbookData, opts: RenderOptions = {}) {
  const fams = Array.from(new Set([d.tipografia.display.familia, d.tipografia.texto.familia].filter(Boolean)));
  const fontsHead = opts.fontsCss ? `<style>${opts.fontsCss}</style>` : googleFontsLink(fams);
  const title = `Brandbook ${d.meta.brand}`;
  const banner = opts.exampleBanner ? `<div class="example-banner">Conteúdo de exemplo: gerado sem chave de IA. Conecte o Claude em Configurações e regere o brandbook.</div>` : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="Manual de marca de ${attr(d.meta.brand)}: estratégia, logotipo, cores, tipografia, grafismo, linguagem e aplicações.">
<meta name="theme-color" content="${attr(d.palette.dark)}">
<meta name="generator" content="Impacto · ${attr(d.meta.studio.name)}">
${fontsHead}
<style>${css(d)}</style>
</head>
<body id="${slug(d.meta.brand) || 'marca'}">
${banner}
${header(d, opts)}
<main>
${hero(d)}
${diagnostico(d)}
${manifesto(d)}
${pmv(d)}
${valores(d)}
${posicionamento(d)}
${publico(d)}
${personalidade(d)}
${logotipo(d)}
${construcao(d)}
${versoes(d)}
${cores(d)}
${tipografia(d)}
${grafismo(d)}
${linguagem(d)}
${aplicacoes(d)}
${manualSec(d)}
</main>
${closeSec(d)}
<script>${js(Boolean(opts.autoPrint))}</script>
</body>
</html>`;
}

export { isDark };
