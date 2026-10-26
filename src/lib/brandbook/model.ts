/**
 * Modelo de conteúdo do brandbook: junta o BrandKit (6 etapas), o enriquecimento editorial feito pela IA
 * (applications.manual.brandbook) e os dados do cliente num objeto completo, sem buracos.
 * Tudo o que faltar recebe um texto de apoio coerente com a marca, para o manual sair inteiro sempre.
 */

import type { BrandKit, Client } from '@/lib/db/types';
import { cmykString, colorFamily, contrast, inkFor, isDark, mixHex, normHex, rgbString, shade } from './color';

const o = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const a = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const s = (v: unknown, fb = ''): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : fb);
const strs = (v: unknown): string[] => a(v).map((x) => (typeof x === 'string' ? x.trim() : s(o(x).texto || o(x).text || o(x).nome))).filter(Boolean);
const pick = <T>(v: T[], n: number): T[] => v.slice(0, n);

export type Swatch = { key: string; name: string; hex: string; rgb: string; cmyk: string; use: string; share: string; ink: string; role: 'dark' | 'light' | 'color' };
export type Pair = { titulo: string; texto: string };
export type Persona = { nome: string; papel?: string; dor: string; desejo: string };
export type MockText = { peca: string; descricao: string; texto: string };

export type BrandbookData = {
  meta: {
    brand: string;
    client: string;
    segment: string;
    city: string;
    version: number;
    status: string;
    mode: string;
    date: string;
    dateISO: string;
    studio: { name: string; instagram: string; site: string; whatsapp: string; city: string };
    whatsapp: string;
    instagram: string;
    website: string;
  };
  logo: { src: string | null; alt: string; wordmark: string; initial: string; sub: string; concept: string; type: string };
  hero: { kicker: string; headline: string; sub: string };
  diagnostico: { percepcao: string; fortes: string[]; incoerencias: string[]; territorios: string[]; oportunidades: string[] };
  manifesto: string[];
  pmv: { proposito: string; missao: string; visao: string };
  valores: Pair[];
  posicionamento: { statement: string; proposta_valor: string; contraponto: string; categoria: string; territorio: string; prova: string; pilares: string[] };
  publico: { descricao: string; personas: Persona[] };
  personalidade: { arquetipo: string; statement: string; pares: [string, string][] };
  simbolo: { conceito: string; significados: Pair[] };
  construcao: { area_protecao: string; tamanhos: { versao: string; valor: string }[] };
  usos_incorretos: string[];
  cores: Swatch[];
  proporcao: { name: string; share: number; hex: string; ink: string }[];
  tipografia: {
    display: { familia: string; para_que: string; como_compor: string; cuidados: string; licenca: string; uppercase: boolean };
    texto: { familia: string; para_que: string; escala: string; licenca: string };
    escala: { nome: string; exemplo: string; tamanho: string; font: 'display' | 'text' }[];
  };
  grafismo: { titulo: string; descricao: string; regras: Pair[] };
  fotografia: Pair[];
  movimento: Pair[];
  moodboards: { src: string; alt: string }[];
  fotos: { src: string; alt: string }[];
  linguagem: {
    tom: { eixo: string; a: string; b: string; valor: number }[];
    descricao_tom: string;
    principios: (Pair & { exemplo: string })[];
    tom_por_canal: { canal: string; tom: string; exemplo: string }[];
    usar: string[];
    evitar: string[];
    bordoes: string[];
    ctas: { objetivo: string; texto: string }[];
    fala_assim: string[];
    nao_fala_assim: string[];
    assinatura: string;
    linha_campanha: string;
    grafia: string;
  };
  aplicacoes: { intro: string; itens: MockText[]; regras: string[] };
  manual: { capitulos: Pair[] };
  tokens: Record<string, string>;
  palette: { bg: string; surface: string; text: string; text2: string; accent: string; accent2: string; primary: string; light: string; dark: string; soft: string };
  skill_md: string;
  fechamento: string;
  isExample: boolean;
};

export type BrandbookExtras = {
  logoSrc?: string | null;
  moodboards?: { src: string; alt: string }[];
  fotos?: { src: string; alt: string }[];
  studio?: Partial<BrandbookData['meta']['studio']>;
  now?: Date;
};

const TOM_AXES: Record<string, [string, string]> = {
  formal_proximo: ['Formal', 'Próximo'],
  serio_divertido: ['Sério', 'Divertido'],
  tecnico_simples: ['Técnico', 'Simples'],
  contido_ousado: ['Contido', 'Ousado'],
};

export function brandName(client: Client) {
  return (client.company || client.contact_name || 'Marca').trim();
}

export function chosenDirection(kit: BrandKit): Record<string, any> {
  const visual = o(kit.visual);
  const dirs = a(visual.direcoes);
  const idx = Number(visual.escolhida);
  return o(dirs[Number.isInteger(idx) ? idx : 0] ?? dirs[0]);
}

function buildPalette(kit: BrandKit, client: Client) {
  const tokens = o(kit.tokens);
  const dir = chosenDirection(kit);
  const p = o(dir.paleta);
  const accent = normHex(tokens.accent, normHex(p.destaque, normHex(client.brand_color, '#ff5b1f')));
  const dark = normHex(tokens.bg, normHex(p.neutra_escura, '#0a0a0a'));
  const light = normHex(tokens.text, normHex(p.neutra_clara, '#f5f5f3'));
  const primary = normHex(tokens.primary, normHex(p.primaria, accent));
  const accent2 = normHex(tokens.accent2, normHex(p.secundaria, mixHex(accent, '#000000', 0.35)));
  const bg = isDark(dark) ? dark : isDark(light) ? light : '#0a0a0a';
  const text = isDark(light) ? (isDark(dark) ? '#f5f5f3' : dark) : light;
  return {
    bg,
    surface: normHex(tokens.surface, mixHex(bg, text, 0.08)),
    text,
    text2: normHex(tokens.text2, mixHex(text, bg, 0.38)),
    accent,
    accent2,
    primary,
    light: isDark(light) ? '#f5f5f3' : light,
    dark: isDark(dark) ? dark : '#0a0a0a',
    soft: mixHex(isDark(light) ? '#f5f5f3' : light, bg, 0.12),
  };
}

function swatches(kit: BrandKit, client: Client, ai: Record<string, any>, pal: ReturnType<typeof buildPalette>): Swatch[] {
  const dir = chosenDirection(kit);
  const p = o(dir.paleta);
  const named = a(ai.cores).map(o);
  const byKey = (k: string) => named.find((c) => s(c.chave) === k) || {};
  const prop = s(p.proporcao, '60/20/15/5').split('/').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  const base: { key: string; hex: string; fallbackName: string; use: string; share: string }[] = [
    { key: 'neutra_escura', hex: pal.dark, fallbackName: `${colorFamily(pal.dark)} ${brandName(client).split(' ')[0]}`, use: 'O fundo principal. Dá profundidade e deixa a cor de destaque aparecer.', share: `${prop[0] ?? 60}%` },
    { key: 'primaria', hex: pal.primary, fallbackName: `${colorFamily(pal.primary)} principal`, use: 'A cor que identifica a marca de longe: logotipo, capas e peças de impacto.', share: `${prop[1] ?? 20}%` },
    { key: 'neutra_clara', hex: pal.light, fallbackName: `${colorFamily(pal.light)} luz`, use: 'Fundos claros, texto sobre escuro e respiro entre blocos.', share: `${prop[2] ?? 15}%` },
    { key: 'destaque', hex: pal.accent, fallbackName: `${colorFamily(pal.accent)} de ação`, use: 'Botões, chamadas, números e o ponto de atenção de cada peça. Pouco e onde importa.', share: `${prop[3] ?? 5}%` },
    { key: 'secundaria', hex: pal.accent2, fallbackName: `${colorFamily(pal.accent2)} de apoio`, use: 'Apoio funcional: hover, gráficos, segundo plano de ilustrações.', share: 'apoio' },
  ];
  const seen = new Set<string>();
  const out: Swatch[] = [];
  for (const b of base) {
    if (seen.has(b.hex)) continue;
    seen.add(b.hex);
    const n = byKey(b.key);
    out.push({
      key: b.key,
      name: s(n.nome, b.fallbackName),
      hex: b.hex.toUpperCase(),
      rgb: rgbString(b.hex),
      cmyk: cmykString(b.hex),
      use: s(n.uso, b.use),
      share: s(n.proporcao, b.share),
      ink: inkFor(b.hex, [pal.dark, pal.light, '#0a0a0a', '#ffffff']),
      role: isDark(b.hex) ? 'dark' : contrast(b.hex, '#ffffff') < 2.2 ? 'light' : 'color',
    });
  }
  return out;
}

function tomBars(verbal: Record<string, any>) {
  const tom = o(verbal.tom);
  return Object.entries(TOM_AXES).map(([k, [A, B]]) => ({ eixo: k, a: A, b: B, valor: Math.max(0, Math.min(100, Number(tom[k] ?? 55) || 55)) }));
}

function ctaList(verbal: Record<string, any>) {
  const c = o(verbal.ctas);
  const labels: Record<string, string> = { venda: 'Venda', salvar: 'Salvar', envio: 'Envio', palavra_chave: 'Palavra-chave', agenda: 'Agenda', contato: 'Contato' };
  return Object.entries(c)
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => ({ objetivo: labels[k] || k, texto: String(v) }));
}

function pairs(v: unknown, tKey = 'titulo', xKey = 'texto'): Pair[] {
  return a(v)
    .map((x) => (typeof x === 'string' ? { titulo: x.split(':')[0].trim(), texto: x.includes(':') ? x.split(':').slice(1).join(':').trim() : '' } : { titulo: s(o(x)[tKey] || o(x).nome || o(x).title), texto: s(o(x)[xKey] || o(x).comportamento || o(x).conteudo || o(x).detail) }))
    .filter((p) => p.titulo);
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function buildBrandbookData(client: Client, kit: BrandKit, extras: BrandbookExtras = {}): BrandbookData {
  const name = brandName(client);
  const first = name.split(' ')[0];
  const diag = o(kit.diagnosis);
  const strat = o(kit.strategy);
  const verbal = o(kit.verbal);
  const apps = o(kit.applications);
  const manual = o(apps.manual);
  const ai = o(manual.brandbook);
  const dir = chosenDirection(kit);
  const tipo = o(dir.tipografia);
  const logoDir = o(dir.logo);
  const tokens = o(kit.tokens);
  const pal = buildPalette(kit, client);
  const segment = s(client.segment, 'negócio');
  const city = [s(client.city), s(client.state)].filter(Boolean).join(', ') || 'Uberlândia, MG';
  const now = extras.now || new Date();
  const date = `${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;
  const assinatura = s(strat.assinatura) || s(ai.assinatura) || `${first}. Feito à vista.`;
  const posicionamento = s(strat.posicionamento) || `${name}: ${segment.toLowerCase()} com prova à vista.`;
  const fontDisplay = s(tokens.font_display) || s(tipo.display) || 'Barlow Condensed';
  const fontText = s(tokens.font_text) || s(tipo.texto) || 'Instrument Sans';
  const displayUpper = /condensed|bebas|oswald|anton|foun|league gothic|barlow|archivo black|teko|fjalla/i.test(fontDisplay) || Boolean(ai.display_caixa_alta ?? true);
  const personas: Persona[] = a(strat.personas)
    .map(o)
    .map((p) => ({ nome: s(p.nome, 'Persona'), papel: s(p.papel || p.cargo), dor: s(p.dor), desejo: s(p.desejo) }))
    .filter((p) => p.dor || p.desejo);
  const pilares = strs(strat.pilares);
  const aiPers = o(ai.personalidade);
  const paresRaw = a(aiPers.pares).length ? a(aiPers.pares) : strs(aiPers.somos).map((x, i) => [x, strs(aiPers.nao_somos)[i] || '']);
  const pares = paresRaw.map((p): [string, string] => (Array.isArray(p) ? [s(p[0]), s(p[1])] : [s(o(p).somos), s(o(p).nao_somos)])).filter((p) => p[0]);
  const defaultPares: [string, string][] = [
    ['Diretos', 'Secos'],
    ['Próximos', 'Informais demais'],
    ['Confiantes', 'Arrogantes'],
    ['Técnicos', 'Complicados'],
    ['Criativos', 'Aleatórios'],
    ['Consistentes', 'Repetitivos'],
  ];
  const aiTipo = o(ai.tipografia);
  const aiDisp = o(aiTipo.display);
  const aiTxt = o(aiTipo.texto);
  const aiGraf = o(ai.grafismo);
  const aiLing = o(ai.linguagem);
  const aiSimb = o(ai.simbolo);
  const aiConst = o(ai.construcao);
  const aplicacoesItens: MockText[] = a(apps.aplicacoes)
    .map(o)
    .map((x) => ({ peca: s(x.peca), descricao: s(x.descricao), texto: s(x.texto_exemplo || x.texto) }))
    .filter((x) => x.peca);
  const swatchList = swatches(kit, client, ai, pal);
  const proporcao = swatchList
    .map((sw) => ({ name: sw.name, share: Number(String(sw.share).replace(/[^0-9.]/g, '')) || 0, hex: sw.hex, ink: sw.ink }))
    .filter((x) => x.share > 0);
  const totalShare = proporcao.reduce((acc, x) => acc + x.share, 0) || 1;

  return {
    meta: {
      brand: name,
      client: s(client.contact_name),
      segment,
      city,
      version: kit.version || 1,
      status: kit.status,
      mode: kit.mode,
      date,
      dateISO: now.toISOString().slice(0, 10),
      studio: {
        name: extras.studio?.name || 'Studio Impacto',
        instagram: extras.studio?.instagram || '@astudioimpacto',
        site: extras.studio?.site || 'studioimpacto.com.br',
        whatsapp: extras.studio?.whatsapp || '(34) 99899-0606',
        city: extras.studio?.city || 'Uberlândia, MG',
      },
      whatsapp: s(client.whatsapp),
      instagram: (client.socials || []).find((x) => /insta/i.test(x.rede))?.url || '',
      website: s(client.website),
    },
    logo: {
      src: extras.logoSrc || client.logo_url || null,
      alt: name,
      wordmark: name,
      initial: (first[0] || 'M').toUpperCase(),
      sub: s(logoDir.sub) || (name.split(' ').length > 1 ? '' : segment),
      concept: s(aiSimb.conceito) || s(logoDir.conceito) || `O logotipo é o nome ${name} desenhado na ${fontDisplay}, com um ponto na cor de destaque: o sinal que faz alguém olhar.`,
      type: s(logoDir.tipo, 'logotipo'),
    },
    hero: {
      kicker: `${name} · Manual de marca, versão ${kit.version || 1}.0 · ${city}, ${date}`,
      headline: assinatura,
      sub: s(ai.hero_sub) || posicionamento,
    },
    diagnostico: {
      percepcao: s(diag.percepcao_atual) || `${name} é lembrada como ${segment.toLowerCase()} de ${city.split(',')[0]}, mas ainda sem uma ideia central que a separe de quem faz o mesmo.`,
      fortes: pick(strs(diag.pontos_fortes), 6),
      incoerencias: pick(strs(diag.incoerencias), 6),
      territorios: pick(strs(diag.territorios_concorrentes), 6),
      oportunidades: pick(strs(diag.oportunidades), 6),
    },
    manifesto: strs(ai.manifesto).length
      ? strs(ai.manifesto)
      : [
          `Todo dia, dezenas de ${segment.toLowerCase()} pedem atenção. Poucas são lembradas.`,
          `A diferença não está no volume. Está na prova: o que ${name} faz, mostrado como é feito.`,
          `${s(strat.proposito) || 'A gente existe para ser escolhida pelo que entrega, não pelo que promete.'}`,
          `Por isso ${name} fala pouco e mostra muito. Número no lugar de adjetivo. Processo no lugar de slogan.`,
          `${assinatura}`,
        ],
    pmv: {
      proposito: s(strat.proposito) || `Fazer ${name} ser vista, lembrada e escolhida pelo que entrega.`,
      missao: s(o(ai.pmv).missao || ai.missao) || `Entregar ${segment.toLowerCase()} com padrão combinado, prazo cumprido e acompanhamento do início ao fim.`,
      visao: s(o(ai.pmv).visao || ai.visao) || `Ser a referência de ${segment.toLowerCase()} em ${city.split(',')[0]} para quem compara antes de escolher.`,
    },
    valores: pairs(ai.valores).length
      ? pick(pairs(ai.valores, 'nome', 'comportamento'), 6)
      : pick(
          (pilares.length ? pilares : ['Prova real', 'Processo visível', 'Prazo cumprido', 'Voz próxima']).map((p) => {
            // Pilares longos ("Título: explicação") viram título curto + comportamento
            const i = p.indexOf(':');
            if (i > 0 && i < 60) return { titulo: p.slice(0, i).trim(), texto: p.slice(i + 1).trim() };
            if (p.length > 48) {
              const cut = p.slice(0, 48).lastIndexOf(' ');
              return { titulo: p.slice(0, cut > 20 ? cut : 48).replace(/[,.;]$/, ''), texto: p };
            }
            return { titulo: p, texto: '' };
          }),
          6,
        ),
    posicionamento: {
      statement: posicionamento,
      proposta_valor: s(strat.proposta_valor) || 'Entrega combinada, processo visível e acompanhamento do início ao fim.',
      contraponto: s(strat.contraponto) || 'Contra a promessa sem prova e o discurso genérico do setor.',
      categoria: s(o(ai.posicionamento).categoria) || segment,
      territorio: s(o(ai.posicionamento).territorio) || (pilares[0] ? `${pilares[0]}.` : 'Prova real.'),
      prova: s(o(ai.posicionamento).prova) || s(strat.proposta_valor) || 'Processo aberto e resultado medido.',
      pilares,
    },
    publico: {
      descricao: s(strat.publico) || `Quem decide a contratação de ${segment.toLowerCase()} em ${city.split(',')[0]} e compara três opções antes de chamar.`,
      personas,
    },
    personalidade: {
      arquetipo: s(strat.arquetipo) || 'Criador',
      statement: s(aiPers.statement) || `Se ${name} fosse uma pessoa, seria quem chega antes, mostra o processo e cumpre a data: ${s(strat.arquetipo, 'o Criador').toLowerCase()} com a mão na massa.`,
      pares: pares.length ? pick(pares, 7) : defaultPares,
    },
    simbolo: {
      conceito: s(aiSimb.conceito) || s(logoDir.conceito) || `${s(logoDir.tipo, 'Logotipo')} em ${fontDisplay}, com o ponto na cor de destaque como marca de atenção.`,
      significados: pairs(aiSimb.significados, 'nome', 'texto').length
        ? pairs(aiSimb.significados, 'nome', 'texto')
        : [
            { titulo: 'Ponto', texto: 'A cor de destaque marca o lugar para onde o olho vai primeiro.' },
            { titulo: 'Nome inteiro', texto: 'A marca se apresenta pelo nome, sem abreviação, para ser lembrada.' },
            { titulo: 'Caixa alta', texto: 'Títulos firmes, de leitura rápida, como num cartaz.' },
            { titulo: 'Respiro', texto: 'Área de proteção igual à altura da letra, para o logo nunca disputar espaço.' },
          ],
    },
    construcao: {
      area_protecao: s(aiConst.area_protecao) || 'O módulo de tudo é a altura da letra maiúscula do logotipo (x). A área de proteção tem 1x em todos os lados e nada entra nela: texto, foto, outro logo ou borda.',
      tamanhos: a(aiConst.tamanhos).length
        ? a(aiConst.tamanhos).map(o).map((t) => ({ versao: s(t.versao), valor: s(t.valor) }))
        : [
            { versao: 'Principal (horizontal)', valor: '30 mm · 140 px' },
            { versao: 'Vertical', valor: '22 mm · 96 px' },
            { versao: 'Símbolo', valor: '8 mm · 24 px' },
            { versao: 'Favicon', valor: '16 px (só o símbolo)' },
          ],
    },
    usos_incorretos: strs(ai.usos_incorretos).length
      ? pick(strs(ai.usos_incorretos), 8)
      : ['Esticar ou achatar', 'Girar', 'Trocar as cores por outras fora da paleta', 'Aplicar sombra, contorno ou brilho', 'Sobre foto sem contraste', 'Com outra fonte', 'Dentro de caixa ou moldura', 'Com o ponto de outra cor'],
    cores: swatchList,
    proporcao: proporcao.map((x) => ({ ...x, share: Math.round((x.share / totalShare) * 100) })),
    tipografia: {
      display: {
        familia: fontDisplay,
        para_que: s(aiDisp.para_que) || 'Títulos, números grandes, palavras de impacto, capas e vinhetas.',
        como_compor: s(aiDisp.como_compor) || `Entrelinha de 0,9 a 1,0. ${displayUpper ? 'Sempre em caixa alta.' : 'Caixa alta e baixa, sem versalete.'} Nunca condensar ou esticar a fonte.`,
        cuidados: s(aiDisp.cuidados) || 'Uma fonte de título por peça. Em texto corrido, nunca.',
        licenca: s(tipo.licenca) || 'Google Fonts, uso livre',
        uppercase: displayUpper,
      },
      texto: {
        familia: fontText,
        para_que: s(aiTxt.para_que) || 'Textos, interface, legendas, propostas e contratos. Faz todo o resto.',
        escala: s(aiTxt.escala) || 'Corpo entre 16 e 19 px na tela; 10 a 11 pt no impresso. Entrelinha 1,5.',
        licenca: s(tipo.licenca) || 'Google Fonts, uso livre',
      },
      escala: [
        { nome: 'Display', exemplo: first, tamanho: '72 a 184 px', font: 'display' },
        { nome: 'Título', exemplo: assinatura.replace(/\.$/, ''), tamanho: '44 a 96 px', font: 'display' },
        { nome: 'Subtítulo', exemplo: posicionamento, tamanho: '24 a 32 px', font: 'text' },
        { nome: 'Lead', exemplo: s(strat.proposta_valor) || 'Entrega combinada, processo visível.', tamanho: '20 a 26 px', font: 'text' },
        { nome: 'Texto', exemplo: 'Frases curtas, uma ideia por frase, número no lugar do adjetivo.', tamanho: '16 a 19 px', font: 'text' },
        { nome: 'Legenda', exemplo: `${name} · ${city}`, tamanho: '13 a 14 px', font: 'text' },
      ],
    },
    grafismo: {
      titulo: s(aiGraf.titulo) || 'Grafismo',
      descricao: s(aiGraf.descricao) || s(dir.grafismo) || 'Um elemento gráfico só, repetido com disciplina: é ele que faz a peça ser reconhecida sem ler o logo.',
      regras: pairs(aiGraf.regras).length
        ? pick(pairs(aiGraf.regras), 6)
        : [
            { titulo: 'Um elemento por peça', texto: 'O grafismo aparece uma vez, grande ou pequeno, nunca repetido como textura.' },
            { titulo: 'Texto na frente', texto: 'Títulos e logo nunca ficam atrás do grafismo.' },
            { titulo: 'Contraste primeiro', texto: 'Texto sobre cor ou foto precisa de contraste de 4,5 para 1.' },
            { titulo: 'Cor de destaque no ponto certo', texto: 'Só um elemento de destaque por peça: botão, número ou chamada.' },
            { titulo: 'Grade de 12 colunas', texto: 'Margens iguais, títulos no mesmo eixo esquerdo em toda peça.' },
            { titulo: 'Material real', texto: 'Foto e vídeo da marca acima de banco de imagem ou gerado.' },
          ],
    },
    fotografia: pairs(ai.fotografia).length
      ? pick(pairs(ai.fotografia), 3)
      : [
          { titulo: 'Luz', texto: s(dir.fotografia) || 'Uma fonte de luz principal, sombra com informação, nada estourado.' },
          { titulo: 'Gente de verdade', texto: 'Equipe, cliente e produto em uso. Nada de pose de banco de imagem.' },
          { titulo: 'Cor', texto: 'Mesma correção de cor em todo material antes de publicar.' },
        ],
    movimento: pairs(ai.movimento).length
      ? pick(pairs(ai.movimento), 3)
      : [
          { titulo: 'Assinatura', texto: s(dir.motion) || 'O logo entra em 2 a 3 segundos, com o ponto chegando por último.' },
          { titulo: 'Ritmo', texto: 'Cortes secos, texto entrando em duas batidas. Nada tremendo ou piscando.' },
          { titulo: 'Reduzir movimento', texto: 'Na web, respeitar a preferência do sistema e manter tudo legível parado.' },
        ],
    moodboards: extras.moodboards || [],
    fotos: extras.fotos || [],
    linguagem: {
      tom: tomBars(verbal),
      descricao_tom: s(verbal.descricao_tom) || (typeof verbal.tom === 'string' ? s(verbal.tom) : '') || 'Próximo, direto e seguro. Frases curtas, uma ideia por frase, número no lugar do adjetivo.',
      principios: a(aiLing.principios).length
        ? a(aiLing.principios).map(o).map((p) => ({ titulo: s(p.titulo), texto: s(p.texto), exemplo: s(p.exemplo) })).filter((p) => p.titulo)
        : [
            { titulo: 'Uma ideia por frase', texto: 'Frases curtas, verbos fortes, ritmo de fala.', exemplo: strs(verbal.fala_assim)[0] || 'Entrego dia 12. Se atrasar, aviso antes.' },
            { titulo: 'Número no lugar do adjetivo', texto: 'Dado concreto convence mais do que elogio.', exemplo: 'São 3 etapas. A primeira começa amanhã.' },
            { titulo: 'Clareza antes de criatividade', texto: 'O cliente entende o que vai receber, quando e quanto custa.', exemplo: 'Proposta em 48 horas, apresentada ao vivo.' },
            { titulo: 'Próximo sem caricatura', texto: '"A gente" nas redes e no WhatsApp; registro formal em proposta e contrato.', exemplo: 'A gente te chama assim que o material ficar pronto.' },
            { titulo: 'Promessa que dá para cumprir', texto: 'Método, prazo e acompanhamento. Nunca resultado garantido.', exemplo: 'Acompanhamos todo dia e mandamos o relatório na sexta.' },
          ],
      tom_por_canal: a(aiLing.tom_por_canal).length
        ? a(aiLing.tom_por_canal).map(o).map((c) => ({ canal: s(c.canal), tom: s(c.tom), exemplo: s(c.exemplo) })).filter((c) => c.canal)
        : [
            { canal: 'Instagram', tom: 'Próximo e direto, uma chamada por peça.', exemplo: strs(verbal.bordoes)[0] || assinatura },
            { canal: 'WhatsApp', tom: 'Resposta curta, nome da pessoa, próximo passo claro.', exemplo: 'Oi, [nome]! Aqui é da ' + name + '. Me conta o que você precisa e te passo o caminho.' },
            { canal: 'Site', tom: 'Afirmativo, com prova e número.', exemplo: posicionamento },
            { canal: 'Proposta', tom: 'Registro formal, escopo e prazo por extenso.', exemplo: 'Entrega em 15 dias úteis após a aprovação.' },
            { canal: 'E-mail', tom: 'Cordial e objetivo, assunto com a ação.', exemplo: 'Assunto: proposta ' + name + ' · aprovação até sexta' },
          ],
      usar: strs(verbal.vocabulario_proprio),
      evitar: strs(verbal.proibidos),
      bordoes: strs(verbal.bordoes),
      ctas: ctaList(verbal),
      fala_assim: strs(verbal.fala_assim),
      nao_fala_assim: strs(verbal.nao_fala_assim),
      assinatura,
      linha_campanha: s(strat.linha_campanha),
      grafia: s(aiLing.grafia) || `Escreve-se "${name}", sempre assim, sem variações. Sem travessão nos textos da marca: use ponto, vírgula ou dois-pontos.`,
    },
    aplicacoes: {
      intro: s(ai.aplicacoes_intro) || 'Exemplos de aplicação com os tokens da marca. Toda peça nova parte destes modelos: mesma grade, mesma cor de destaque, mesma voz.',
      itens: aplicacoesItens,
      regras: strs(apps.regras_uso),
    },
    manual: { capitulos: pairs(manual.capitulos, 'titulo', 'conteudo') },
    tokens: Object.fromEntries(Object.entries(tokens).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)])),
    palette: pal,
    skill_md: s(manual.skill_md),
    fechamento: s(ai.fechamento) || `${assinatura} ${name}, ${city.split(',')[0]}.`,
    isExample: Boolean(ai._example),
  };
}

/** Quais fontes do Google precisam ser carregadas. */
export function brandbookFonts(data: BrandbookData): string[] {
  return Array.from(new Set([data.tipografia.display.familia, data.tipografia.texto.familia].filter(Boolean)));
}

export { shade };
