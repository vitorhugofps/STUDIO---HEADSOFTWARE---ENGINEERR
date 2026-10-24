import 'server-only';
import { hashPassword } from '@/lib/password';
import { addDays, todayISO } from '@/lib/utils';
import type { DB } from './types';

/**
 * Dados iniciais do Studio Impacto. Rodam uma vez quando o banco está vazio
 * (modo local: também cria os 4 usuários; no Supabase os usuários vêm do Auth).
 */

export const TEAM = [
  { id: '00000000-0000-4000-8000-000000000001', username: 'VITOR', full_name: 'Vitor Filgueiras', role: 'admin', title: 'Head de Marketing e Engenharia' },
  { id: '00000000-0000-4000-8000-000000000002', username: 'MARCOS', full_name: 'Marcos', role: 'developer', title: 'System Developer' },
  { id: '00000000-0000-4000-8000-000000000003', username: 'PEDROPAULO', full_name: 'Pedro Paulo', role: 'comercial', title: 'Sales' },
  { id: '00000000-0000-4000-8000-000000000004', username: 'YURI', full_name: 'Yuri', role: 'editor', title: 'Video Editor' },
] as const;

export const DEFAULT_PASSWORD = 'impacto2026';

const C = {
  gibson: '10000000-0000-4000-8000-000000000001',
  bny: '10000000-0000-4000-8000-000000000002',
  amala: '10000000-0000-4000-8000-000000000003',
  rota: '10000000-0000-4000-8000-000000000004',
  cintia: '10000000-0000-4000-8000-000000000005',
  marcus: '10000000-0000-4000-8000-000000000006',
  felipe: '10000000-0000-4000-8000-000000000007',
  darc: '10000000-0000-4000-8000-000000000008',
  borges: '10000000-0000-4000-8000-000000000009',
};

const P = {
  gibsonFeed: '20000000-0000-4000-8000-000000000001',
  gibsonReels: '20000000-0000-4000-8000-000000000002',
  cintiaTrafego: '20000000-0000-4000-8000-000000000003',
  bnyBrand: '20000000-0000-4000-8000-000000000004',
  amalaSite: '20000000-0000-4000-8000-000000000005',
  rotaVideo: '20000000-0000-4000-8000-000000000006',
  gibsonSite: '20000000-0000-4000-8000-000000000007',
  bnyTrafego: '20000000-0000-4000-8000-000000000008',
};

const CAMP = { cintia: '30000000-0000-4000-8000-000000000001', bny: '30000000-0000-4000-8000-000000000002' };
const VITOR = TEAM[0].id;
const YURI = TEAM[3].id;
const PEDRO = TEAM[2].id;
const MARCOS = TEAM[1].id;

const d = (n: number) => addDays(new Date(), n).toISOString();
const day = (n: number) => addDays(new Date(), n).toISOString().slice(0, 10);

export async function ensureSeed(db: DB) {
  const g = globalThis as unknown as { __ihsSeeded?: boolean };
  if (g.__ihsSeeded) return;
  const existing = await db.list('services_catalog', { limit: 1 });
  if (existing.length) {
    g.__ihsSeeded = true;
    return;
  }
  await seedAll(db, db.mode === 'local');
  g.__ihsSeeded = true;
}

export async function seedAll(db: DB, withProfiles: boolean) {
  if (withProfiles) {
    const existing = await db.list('profiles', { limit: 1 });
    if (!existing.length) {
      for (const t of TEAM) {
        await db.insert('profiles', { ...t, password_hash: hashPassword(DEFAULT_PASSWORD), status: 'disponivel' } as any);
      }
    }
  }

  // Catálogo de serviços (tabela de referência do Studio)
  const services = [
    ['Marca completa', 'Marca', 'projeto', 6500, false, 'Diagnóstico, estratégia, sistema verbal e visual, manual da marca'],
    ['Landing page', 'Sites', 'projeto', 3500, false, 'Página única com formulário para WhatsApp, pixel e domínio'],
    ['Site de artista ou banda', 'Sites', 'projeto', 6500, false, 'Site completo com intro em vídeo, vídeos mais vistos, agenda e contratação'],
    ['Presença (conteúdo mensal)', 'Conteúdo', 'mensal', 3500, true, 'Feed, stories e Reels no mês, com aprovação'],
    ['Performance (tráfego mensal)', 'Tráfego', 'mensal', 2800, true, 'Campanhas Meta Ads e relatórios; verba de mídia à parte'],
    ['Impacto 360', 'Impacto 360', 'mensal', 8500, true, 'Conteúdo, tráfego, vídeo e acompanhamento no mesmo plano'],
    ['Diária de captação', 'Vídeo', 'avulso', 2200, false, 'Equipe e câmeras de cinema e profissionais, sempre à parte'],
    ['Roteiros mensais (4)', 'Vídeo', 'mensal', 1200, true, 'Quatro roteiros por mês'],
    ['Manutenção de site', 'Sites', 'mensal', 290, true, 'Até 4 atualizações por mês'],
  ] as const;
  for (const [name, front, kind, base_price, recurring, description] of services) {
    await db.insert('services_catalog', { name, front, kind, base_price, recurring, description } as any);
  }

  // Clientes
  const clients = [
    { id: C.gibson, contact_name: 'GIBSON Promoções', company: 'GIBSON Promoções', segment: 'Escritório musical', city: 'Uberlândia', state: 'MG', status: 'ativo', health: 'verde', website: 'https://gibsonpromocoes.com.br', whatsapp: '(34) 3222-0200', brand_color: '#E10600', who_is: 'Escritório de empresariamento artístico. Agencia Dino Fonseca, Cintia Férsi, A MALA e Jhean. Produz os eventos Quinta Hits e Barzim de Rock.', report_emails: [], socials: [{ rede: 'instagram', url: 'https://instagram.com/gibsonpromocoes' }], owner_id: VITOR, maturity_index: 62 },
    { id: C.bny, contact_name: 'Rodrigo', company: 'Banda Nova York', segment: 'Banda', city: 'Uberlândia', state: 'MG', status: 'ativo', health: 'verde', website: 'https://app.bandanovayork.com.br', whatsapp: '', brand_color: '#F5C400', who_is: 'Banda de baile com repertório completo. Reposicionamento de marca, comunicação e desenvolvimento comercial, parceria remunerada com exclusividade de 12 meses.', report_emails: [], socials: [{ rede: 'instagram', url: 'https://instagram.com/bandanovayork' }], owner_id: VITOR, maturity_index: 48 },
    { id: C.amala, contact_name: 'Maria Laís', company: 'A MALA', segment: 'Artista', city: 'Uberlândia', state: 'MG', status: 'ativo', health: 'verde', website: 'https://marialais.com.br', whatsapp: '(34) 98400-9272', brand_color: '#1FE5FF', who_is: 'Cantora sertaneja agenciada pela GIBSON. DVD autoral "Mais ou Menos Assim". Site, identidade v3 e peças do clipe "Doeu, Viu?".', report_emails: [], socials: [{ rede: 'instagram', url: 'https://instagram.com/amalacanta' }], owner_id: VITOR, maturity_index: 71 },
    { id: C.rota, contact_name: 'Rota das Pousadas', company: 'Rota das Pousadas', segment: 'Turismo', city: 'Uberlândia', state: 'MG', status: 'ativo', health: 'amarelo', website: 'https://rotadaspousadas.com.br', whatsapp: '', brand_color: '#D4A24C', who_is: 'Rota turística de pousadas. Redesign do site, nova logo e vídeo de 45 s em motion graphics.', report_emails: [], socials: [], owner_id: VITOR, maturity_index: 55 },
    { id: C.cintia, contact_name: 'Cintia Férsi', company: 'Cintia Férsi · Tia do Rock', segment: 'Artista', city: 'Uberlândia', state: 'MG', status: 'ativo', health: 'verde', website: '', whatsapp: '', email: 'Cfersi@hotmail.com', report_emails: ['Cfersi@hotmail.com'], brand_color: '#FF2D55', who_is: 'Cantora do Baile da Tia Cíntia. Nicho GIBSON: show acústico premium para eventos corporativos e prefeituras. Campanha Meta Ads para o show no Bar Charles Edward (SP), 06/11.', socials: [{ rede: 'instagram', url: 'https://instagram.com/cintiafersi' }], owner_id: VITOR, maturity_index: 44 },
    { id: C.marcus, contact_name: 'Marcus Fahd', company: 'Clínica Inti', segment: 'Odontologia', city: 'Uberlândia', state: 'MG', status: 'proposta', health: 'amarelo', website: '', whatsapp: '', brand_color: '#2EC4B6', who_is: 'Dentista. Marca pessoal e edição mensal de vídeos (YouTube e Shorts). Orçamento 2026-045 enviado.', report_emails: [], socials: [], owner_id: PEDRO, maturity_index: 38 },
    { id: C.felipe, contact_name: 'Felipe Vox', company: 'Felipe Vox', segment: 'Artista', city: 'Uberlândia', state: 'MG', status: 'proposta', health: 'amarelo', website: '', whatsapp: '', brand_color: '#8B5CF6', who_is: 'Músico de casamentos, festas de 15 anos e formaturas. Landing page personalizada a partir dos modelos de artista do Studio. Orçamento 2026-046.', report_emails: [], socials: [], owner_id: PEDRO, maturity_index: 35 },
    { id: C.darc, contact_name: 'Darc', company: 'Darc Cabeleireiros', segment: 'Beleza', city: 'Uberlândia', state: 'MG', status: 'lead', health: 'amarelo', website: '', whatsapp: '', brand_color: '#C0C0C0', who_is: 'Salão de beleza. Pitch deck apresentado; aguardando diagnóstico.', report_emails: [], socials: [], owner_id: PEDRO, maturity_index: 30 },
    { id: C.borges, contact_name: 'Borges & Fidélis', company: 'Borges & Fidélis Advocacia', segment: 'Jurídico', city: 'Uberlândia', state: 'MG', status: 'encerrado', health: 'verde', website: 'https://advogandoparamedicos.com.br', whatsapp: '', brand_color: '#1E3A5F', who_is: 'Escritório de advocacia para médicos. Redesign do site entregue.', report_emails: [], socials: [], owner_id: VITOR, maturity_index: 60 },
  ];
  for (const c of clients) await db.insert('clients', { ...c, created_at: d(-60) } as any);

  // Projetos
  const projects = [
    { id: P.gibsonFeed, client_id: C.gibson, kind: 'feed', title: 'Feed GIBSON · lote 1 (20 posts em 30 dias)', method_stage: 'set', status: 'aguardando_aprovacao', progress: 65, starts_on: day(-10), due_on: day(20), owner_id: VITOR },
    { id: P.gibsonReels, client_id: C.gibson, kind: 'reels', title: 'Reels GIBSON · 3 por semana (refrões dos DVDs)', method_stage: 'set', status: 'ativo', progress: 40, starts_on: day(-7), due_on: day(23), owner_id: YURI },
    { id: P.gibsonSite, client_id: C.gibson, kind: 'site', title: 'Site gibsonpromocoes.com.br · versão mobile (links + agenda)', method_stage: 'roteiro', status: 'ativo', progress: 25, starts_on: day(-3), due_on: day(25), owner_id: MARCOS },
    { id: P.cintiaTrafego, client_id: C.cintia, kind: 'trafego', title: 'Campanha Baile da Tia Cíntia · Bar Charles Edward (SP)', method_stage: 'estreia', status: 'ativo', progress: 70, starts_on: day(-5), due_on: '2026-11-06', owner_id: VITOR },
    { id: P.bnyBrand, client_id: C.bny, kind: 'brand', title: 'Reposicionamento de marca Banda Nova York', method_stage: 'roteiro', status: 'ativo', progress: 45, starts_on: day(-20), due_on: day(30), owner_id: VITOR },
    { id: P.bnyTrafego, client_id: C.bny, kind: 'trafego', title: 'Tráfego BNY · agenda de shows', method_stage: 'temporada', status: 'ativo', progress: 80, starts_on: day(-30), due_on: day(60), owner_id: VITOR },
    { id: P.amalaSite, client_id: C.amala, kind: 'site', title: 'Site marialais.com.br (identidade v3)', method_stage: 'temporada', status: 'finalizado', progress: 100, starts_on: day(-50), due_on: day(-8), owner_id: VITOR },
    { id: P.rotaVideo, client_id: C.rota, kind: 'motion', title: 'Vídeo 45 s Rota das Pousadas (HyperFrames)', method_stage: 'temporada', status: 'finalizado', progress: 100, starts_on: day(-30), due_on: day(-12), owner_id: YURI },
  ];
  for (const p of projects) await db.insert('projects', p as any);

  // Tarefas
  const tasks = [
    { project_id: P.gibsonFeed, client_id: C.gibson, title: 'Revisar legendas do lote 1 (posts 11 a 20)', assignee_id: VITOR, status: 'fazendo', priority: 1, due_at: d(1) },
    { project_id: P.gibsonReels, client_id: C.gibson, title: 'Cortar refrão do DVD do Dino · Reel 04', assignee_id: YURI, status: 'a_fazer', priority: 1, due_at: d(2) },
    { project_id: P.gibsonReels, client_id: C.gibson, title: 'Legenda animada no padrão GIBSON · Reel 03', assignee_id: YURI, status: 'revisao', priority: 2, due_at: d(0) },
    { project_id: P.cintiaTrafego, client_id: C.cintia, title: 'Conferir relatório diário da Cintia antes do envio', assignee_id: VITOR, status: 'a_fazer', priority: 1, due_at: d(0) },
    { project_id: P.bnyBrand, client_id: C.bny, title: 'Apresentar 3 direções visuais ao Rodrigo', assignee_id: VITOR, status: 'a_fazer', priority: 2, due_at: d(5) },
    { project_id: P.gibsonSite, client_id: C.gibson, title: 'Questionário de contratação para o WhatsApp (34) 3222-0200', assignee_id: MARCOS, status: 'fazendo', priority: 2, due_at: d(4) },
    { client_id: C.marcus, title: 'Follow-up D+5 da proposta 2026-045', assignee_id: PEDRO, status: 'a_fazer', priority: 1, due_at: d(-1) },
    { client_id: C.felipe, title: 'Follow-up D+2 da proposta 2026-046', assignee_id: PEDRO, status: 'a_fazer', priority: 2, due_at: d(1) },
    { client_id: C.darc, title: 'Agendar Diagnóstico de 45 min', assignee_id: PEDRO, status: 'a_fazer', priority: 3, due_at: d(3) },
  ];
  for (const t of tasks) await db.insert('tasks', t as any);

  // Contexto e diagnóstico de exemplo (GIBSON)
  await db.insert('client_contexts', {
    client_id: C.gibson,
    version: 1,
    created_by: VITOR,
    blocks: {
      quem_e: 'Escritório musical de Uberlândia que empresaria Dino Fonseca, Cintia Férsi, A MALA e Jhean. Produz os eventos Quinta Hits e Barzim de Rock (07/11, Castelli Master).',
      oferece: 'Shows e casting para eventos corporativos, prefeituras, bares e festas. Produção de eventos próprios.',
      id_visual: 'Logo vermelha vetorial oficial (LOGO_-_GIBSON.pdf). Site novo no ar com intro 4K e foco nos DVDs mais vistos.',
      linguagem: 'Assinatura "Música conecta pessoas" e tagline "Boa música, bons encontros sempre". Cintia só como show acústico premium corporativo.',
      dores: 'Feed parado; agenda dos artistas espalhada; contratação chega por WhatsApp sem triagem.',
      notas: 'Aprovação sempre pelo Vitor antes de publicar. Aniversário do Dino em 22/10 (carrossel + story).',
    },
    ai_summary: 'Escritório musical com marca forte e site novo; precisa de recorrência de conteúdo, triagem de contratação e agenda unificada.',
  } as any);

  await db.insert('diagnoses', {
    client_id: C.gibson,
    summary: 'A GIBSON tem marca, artistas e um site novo, mas a presença digital não sustenta a contratação: o feed está parado, os pedidos chegam sem triagem e a agenda dos artistas não aparece em lugar nenhum.',
    pain_map: { comercial: 6, trafego: 5, conteudo: 8, video: 6, marca: 3, site: 2, atendimento: 7 },
    findings: [
      { title: 'Feed sem recorrência', detail: 'Último ciclo de posts foi irregular; os artistas têm DVDs com milhões de visualizações que não aparecem no feed.', severity: 'alta' },
      { title: 'Contratação sem triagem', detail: 'Os pedidos chegam no WhatsApp sem tipo de evento, cidade, data e público. O time perde tempo qualificando à mão.', severity: 'alta' },
      { title: 'Agenda invisível', detail: 'Contratantes não veem as datas livres; a versão mobile do site resolve com agenda e questionário.', severity: 'media' },
    ],
    recommended_services: [
      { front: 'Conteúdo', service: 'Presença (conteúdo mensal)', why: '20 posts e 12 Reels por mês a partir dos refrões dos DVDs', priority: 1 },
      { front: 'Sites', service: 'Versão mobile do site com agenda e questionário', why: 'Triagem automática da contratação direto no WhatsApp', priority: 2 },
      { front: 'Tráfego', service: 'Performance (tráfego mensal)', why: 'Campanha Palco para prefeituras e corporativo no Triângulo', priority: 3 },
    ],
    recommended_plan: 'Temporada',
    pending_items: ['Fotos recentes do Jhean', 'Acesso à conta de anúncios da GIBSON', 'Agenda de novembro dos quatro artistas'],
  } as any);

  // Brand kits
  await db.insert('brand_kits', {
    client_id: C.amala,
    mode: 'rebranding',
    version: 3,
    step: 6,
    status: 'aprovado',
    approved_at: d(-15),
    strategy: { posicionamento: 'A voz de uma nova geração', assinatura: 'A Mala canta!', frase_conceito: 'É mais ou menos assim…' },
    verbal: { tom: 'Primeira pessoa, próximo, afetivo, mineiro sem caricatura', proibidos: ['experiência única', 'clichês sem prova'], bordoes: ['A voz de uma nova geração', 'A Mala canta!', 'Obrigada por fazerem parte disso'] },
    visual: { fonte_display: 'Bricolage Grotesque', fonte_apoio: 'Bodoni Moda (só no nome do DVD)', logo: 'MARIA LAÍS + barras de equalizador no contorno de violão', proibido: ['recorte em arco', 'tela com som/sem som', 'glassmorphism decorativo'] },
    tokens: { bg: '#060608', surface: '#0e0e14', text: '#FFFFFF', text2: '#a2a2b0', accent: '#1fe5ff', accent2: '#ff4fb8' },
  } as any);
  await db.insert('brand_kits', {
    client_id: C.bny,
    mode: 'rebranding',
    version: 1,
    step: 3,
    status: 'rascunho',
    strategy: { posicionamento: 'A banda que faz a festa inteira cantar junto', contraponto: 'Frases saturadas: "todos cantam e dançam", "a Nova York não é apenas uma banda"' },
    verbal: { tom: 'Energia de palco, direto, sem clichê', proibidos: ['todos cantam e dançam', 'a Nova York não é apenas uma banda'] },
    tokens: { bg: '#0A0A0A', accent: '#F5C400', text: '#F5F5F3' },
  } as any);

  // Plano de conteúdo e peças (GIBSON lote 1)
  const plan = await db.insert('content_plans', {
    client_id: C.gibson,
    project_id: P.gibsonFeed,
    month: todayISO().slice(0, 7),
    goal: 'Relançar o feed com 20 posts em 30 dias a partir dos DVDs mais vistos e da agenda de shows',
    mix: { prova: 30, educativo: 20, bastidor: 25, opiniao: 10, oferta: 15 },
    series: [
      { name: 'REFRÃO', goal: 'Prova: momentos mais vistos dos DVDs', format: 'Carrossel 4:5' },
      { name: 'AGENDA', goal: 'Oferta: datas e contratação', format: 'Post 4:5' },
      { name: 'BASTIDOR', goal: 'Confiança: set, palco e estrada', format: 'Post 4:5' },
      { name: 'CASTING', goal: 'Educativo: qual artista para qual evento', format: 'Carrossel 4:5' },
    ],
    status: 'em_aprovacao',
  } as any);
  const items = [
    ['carrossel', 'REFRÃO', 'O refrão que parou o Castelli: Dino ao vivo', 'aprovado', 1],
    ['post_4x5', 'AGENDA', 'Novembro tem Barzim de Rock. Dino e Cintia no mesmo palco.', 'aprovado', 2],
    ['post_4x5', 'BASTIDOR', '6h da manhã. O público chega às 22h.', 'em_aprovacao', 3],
    ['carrossel', 'CASTING', 'Evento corporativo pede show acústico. Cintia Férsi é isso.', 'em_aprovacao', 4],
    ['post_4x5', 'REFRÃO', 'A MALA canta: 100 milhões de visualizações', 'revisado', 6],
    ['story', 'AGENDA', 'Última semana para garantir o Barzim', 'rascunho', 7],
  ] as const;
  for (const [format, series, hook, status, offset] of items) {
    await db.insert('content_items', {
      plan_id: plan.id,
      client_id: C.gibson,
      format,
      series,
      hook,
      art: { headline: hook, support: 'GIBSON Promoções', cta: 'Contrate pelo WhatsApp', palette: 'vermelho' },
      caption: `${hook}\n\nMúsica conecta pessoas. Boa música, bons encontros sempre.\n\n👉🏻 Toque no link da bio e fale com a GIBSON.`,
      alt_text: `Arte 4:5 da série ${series} da GIBSON Promoções`,
      hashtags: ['#gibsonpromocoes', '#uberlandia', '#showaovivo'],
      scheduled_at: d(offset),
      status,
      version: 1,
    } as any);
  }

  // Vídeos
  await db.insert('video_projects', {
    client_id: C.gibson,
    project_id: P.gibsonReels,
    line: 'reels',
    title: 'Reel 04 · Dino Fonseca · refrão "Castelli"',
    status: 'edicao',
    target_duration_s: 40,
    aspect: '9:16',
    direction: { objetivo: 'Prova social e contratação', tom: 'Energia de show', legenda: 'Palavra a palavra, branco com destaque vermelho', trilha: 'Áudio original do DVD' },
    script: { blocks: [
      { t: '0-3s', label: 'Gancho', speech: 'Refrão ao vivo', screen: 'DINO · AO VIVO', visual: 'Plano aberto do palco com plateia' },
      { t: '3-30s', label: 'Refrão', speech: 'Trecho do DVD', screen: 'Letra palavra a palavra', visual: 'Cortes de câmera do DVD' },
      { t: '30-40s', label: 'Chamada', speech: 'Contrate o Dino para o seu evento', screen: 'GIBSON · (34) 3222-0200', visual: 'Logo GIBSON sobre frame escuro' },
    ] },
  } as any);
  await db.insert('video_projects', {
    client_id: C.rota,
    project_id: P.rotaVideo,
    line: 'horizontal',
    title: 'Rota das Pousadas · institucional 45 s',
    status: 'entregue',
    target_duration_s: 45,
    aspect: '16:9',
    direction: { objetivo: 'Institucional', motor: 'HyperFrames econômico', cenas: 'hero, mapa, números, cards, galeria, CTA' },
  } as any);

  // Campanhas e métricas
  await db.insert('campaigns', {
    id: CAMP.cintia,
    client_id: C.cintia,
    project_id: P.cintiaTrafego,
    name: 'Baile da Tia Cíntia · Charles Edward SP',
    objective: 'engajamento',
    funnel: 'FUNDO',
    offer: { descricao: 'Show no Bar Charles Edward, São Paulo, 06/11/2026', destino: 'Link de promoter do bar' },
    geo: { cidade: 'São Paulo', raio_km: 25, idade: '25-55' },
    budget: { total: 500, daily: 50, currency: 'BRL' },
    starts_on: day(-5),
    ends_on: '2026-11-06',
    structure: { tipo: 'CBO', conjuntos: 1, placement: 'Advantage+', criativo: 'Reel em collab com o bar' },
    status: 'ativa',
    meta_campaign_id: '',
  } as any);
  await db.insert('campaigns', {
    id: CAMP.bny,
    client_id: C.bny,
    project_id: P.bnyTrafego,
    name: 'BNY · Agenda de shows (Triângulo)',
    objective: 'mensagens',
    funnel: 'TOPO',
    geo: { cidade: 'Uberlândia', raio_km: 40 },
    budget: { total: 1500, daily: 50, currency: 'BRL' },
    starts_on: day(-30),
    ends_on: day(0),
    status: 'ativa',
  } as any);
  for (let i = 5; i >= 0; i--) {
    const spend = 48 + Math.round(Math.random() * 6);
    const impressions = 9000 + Math.round(Math.random() * 3000);
    const results = 180 + Math.round(Math.random() * 90);
    await db.insert('campaign_metrics_daily', { campaign_id: CAMP.cintia, day: day(-i), spend, impressions, reach: Math.round(impressions * 0.7), clicks: Math.round(impressions * 0.018), results, cost_per_result: Number((spend / results).toFixed(2)), hook_rate: Number((0.24 + Math.random() * 0.08).toFixed(3)) } as any);
  }
  for (let i = 29; i >= 0; i--) {
    const spend = 45 + Math.round(Math.random() * 10);
    const impressions = 6000 + Math.round(Math.random() * 2500);
    const results = 3 + Math.round(Math.random() * 5);
    await db.insert('campaign_metrics_daily', { campaign_id: CAMP.bny, day: day(-i), spend, impressions, reach: Math.round(impressions * 0.65), clicks: Math.round(impressions * 0.012), results, cost_per_result: Number((spend / results).toFixed(2)), hook_rate: Number((0.2 + Math.random() * 0.1).toFixed(3)) } as any);
  }
  await db.insert('report_subscriptions', { client_id: C.cintia, campaign_id: CAMP.cintia, audience: 'cliente', emails: ['Cfersi@hotmail.com'], frequency: 'diario', send_hour: 9, active: true } as any);
  await db.insert('report_subscriptions', { client_id: C.bny, campaign_id: CAMP.bny, audience: 'cliente', emails: [], frequency: 'semanal', send_hour: 9, active: true } as any);

  // Vendas
  const deals = [
    { client_id: C.marcus, title: 'Clínica Inti · marca pessoal + edição mensal', stage: 'proposta', value: 9900, probability: 60, source: 'indicacao', owner_id: PEDRO, next_action_at: d(1) },
    { client_id: C.felipe, title: 'Felipe Vox · landing page de artista', stage: 'proposta', value: 6500, probability: 55, source: 'instagram', owner_id: PEDRO, next_action_at: d(1) },
    { client_id: C.darc, title: 'Darc Cabeleireiros · presença mensal', stage: 'diagnostico', value: 3500, probability: 35, source: 'prospeccao', owner_id: PEDRO, next_action_at: d(3) },
    { client_id: null, title: 'Prefeitura de Monte Carmelo · vídeo institucional', stage: 'qualificacao', value: 12000, probability: 25, source: 'indicacao', owner_id: VITOR, next_action_at: d(6) },
    { client_id: C.bny, title: 'Banda Nova York · parceria 12 meses', stage: 'fechado', value: 42000, probability: 100, source: 'indicacao', owner_id: VITOR },
  ];
  for (const dl of deals) await db.insert('deals', dl as any);

  await db.insert('quotes', { number: '2026-045', client_id: C.marcus, data: { cliente: 'Marcus Fahd', empresa: 'Clínica Inti', itens: ['Implementação de marca pessoal', 'Edição mensal de vídeos sem teto de quantidade'] }, total: 4900, monthly: 2500, valid_until: day(10), status: 'enviada' } as any);
  await db.insert('quotes', { number: '2026-046', client_id: C.felipe, data: { cliente: 'Felipe Vox', itens: ['Criação', 'Personalização', 'Implementação', 'Página de links (cortesia)'] }, total: 6500, monthly: 0, valid_until: day(12), status: 'vista' } as any);

  await db.insert('contracts', { client_id: C.bny, title: 'Parceria Banda Nova York · 12 meses com exclusividade', kind: 'parceria', status: 'assinado', signed_at: d(-25), starts_on: day(-25), ends_on: day(340), value: 0, monthly: 3500 } as any);
  await db.insert('contracts', { client_id: C.gibson, title: 'Presença mensal GIBSON Promoções', kind: 'recorrente', status: 'assinado', signed_at: d(-40), starts_on: day(-40), ends_on: day(325), monthly: 3500 } as any);
  await db.insert('contracts', { client_id: C.cintia, title: 'Campanha Charles Edward · gestão de tráfego', kind: 'projeto', status: 'assinado', signed_at: d(-6), starts_on: day(-6), ends_on: '2026-11-07', value: 800 } as any);

  const invoices = [
    { client_id: C.gibson, description: 'Presença mensal · outubro', amount: 3500, due_on: day(-14), method: 'pix', status: 'paga', paid_at: d(-13) },
    { client_id: C.bny, description: 'Parceria mensal · outubro', amount: 3500, due_on: day(-14), method: 'pix', status: 'paga', paid_at: d(-10) },
    { client_id: C.rota, description: 'Vídeo 45 s · parcela final 50%', amount: 2250, due_on: day(-3), method: 'boleto', status: 'atrasada' },
    { client_id: C.cintia, description: 'Gestão de tráfego · Charles Edward', amount: 800, due_on: day(5), method: 'pix', status: 'aberta' },
    { client_id: C.gibson, description: 'Presença mensal · novembro', amount: 3500, due_on: day(16), method: 'pix', status: 'aberta' },
    { client_id: C.bny, description: 'Parceria mensal · novembro', amount: 3500, due_on: day(16), method: 'pix', status: 'aberta' },
    { client_id: C.amala, description: 'Site marialais.com.br · parcela final', amount: 3250, due_on: day(-40), method: 'pix', status: 'paga', paid_at: d(-38) },
  ];
  for (const inv of invoices) await db.insert('invoices', inv as any);
  for (let m = 1; m <= 5; m++) {
    await db.insert('invoices', { client_id: C.gibson, description: `Presença mensal · M-${m}`, amount: 3500, due_on: day(-30 * m - 14), method: 'pix', status: 'paga', paid_at: d(-30 * m - 12), created_at: d(-30 * m - 20) } as any);
    if (m <= 3) await db.insert('invoices', { client_id: C.amala, description: `Projeto site · parcela ${m}`, amount: 3250, due_on: day(-30 * m - 5), method: 'pix', status: 'paga', paid_at: d(-30 * m - 3), created_at: d(-30 * m - 10) } as any);
  }
  const expenses = [
    { category: 'Ferramentas', supplier: 'Anthropic API', amount: 320, due_on: day(5) },
    { category: 'Ferramentas', supplier: 'Vercel', amount: 110, due_on: day(5) },
    { category: 'Ferramentas', supplier: 'Supabase', amount: 140, due_on: day(5) },
    { category: 'Ferramentas', supplier: 'Apify', amount: 95, due_on: day(5) },
    { category: 'Ferramentas', supplier: 'Higgsfield + Magnific', amount: 260, due_on: day(5) },
    { category: 'Freelancers', supplier: 'Assistente de set · Barzim', amount: 600, due_on: day(12) },
  ];
  for (const e of expenses) await db.insert('expenses', e as any);

  // Jobs e agentes
  await db.insert('jobs', { kind: 'render_reel', runner: 'local_yuri', client_id: C.gibson, project_id: P.gibsonReels, status: 'rodando', progress: 62, log: 'Cortando refrão 01:12 → 01:48 · legenda palavra a palavra', started_at: d(0), input: { video: 'Reel 04 · Dino' } } as any);
  await db.insert('jobs', { kind: 'gerar_feed', runner: 'cloud', client_id: C.gibson, project_id: P.gibsonFeed, status: 'revisao', progress: 100, log: 'Lote 1 gerado · revisão anti-IA: 2 ajustes sugeridos', started_at: d(-1), finished_at: d(-1) } as any);
  await db.insert('jobs', { kind: 'relatorio_diario', runner: 'cloud', client_id: C.cintia, project_id: P.cintiaTrafego, status: 'concluido', progress: 100, log: 'Relatório enviado para Cfersi@hotmail.com', started_at: d(0), finished_at: d(0) } as any);
  await db.insert('agent_runs', { client_id: C.gibson, agent: 'Conteúdo', model: 'claude-sonnet-5-5', input_tokens: 18400, output_tokens: 6200, cost_usd: 0.15, status: 'ok' } as any);
  await db.insert('agent_runs', { client_id: C.gibson, agent: 'Revisor visual', model: 'claude-opus-5-5', input_tokens: 9200, output_tokens: 1400, cost_usd: 0.24, status: 'ok' } as any);
  await db.insert('agent_runs', { client_id: C.cintia, agent: 'Relatórios', model: 'claude-haiku-5-5', input_tokens: 4200, output_tokens: 900, cost_usd: 0.01, status: 'ok' } as any);

  // Aprovações
  await db.insert('approval_batches', { client_id: C.gibson, title: 'Feed GIBSON · lote 1 · posts 1 a 10', item_type: 'content', item_ids: [], public_token: 'gibson-lote1-demo', status: 'aberto', expires_at: d(7) } as any);

  // Pesquisa e concorrentes
  await db.insert('competitors', { client_id: C.bny, name: 'Bandas de baile do Triângulo (benchmark)', instagram: '', notes: 'Linguagem saturada: "todos cantam e dançam". Oportunidade: kit de shows para prefeituras e corporativo.' } as any);
  await db.insert('research_reports', { client_id: null, kind: 'radar', title: 'Radar de tendências · outubro', findings: { destaques: ['Andrômeda: o criativo é o público', 'Collab rende até 5x interações abaixo de 10 mil seguidores', 'Pedir comentário rende +203% de comentários (Metricool 2026)'] }, sources: [{ title: 'Metricool 2026', url: 'https://metricool.com', date: '2026-09' }] } as any);

  // Sites
  await db.insert('sites', { client_id: C.gibson, project_id: P.gibsonSite, name: 'gibsonpromocoes.com.br', template: 'artista-escritorio', repo: 'gibson promocoes - website', domain: 'gibsonpromocoes.com.br', url: 'https://gibsonpromocoes.com.br', status: 'publicado' } as any);
  await db.insert('sites', { client_id: C.amala, project_id: P.amalaSite, name: 'marialais.com.br', template: 'artista-v3', domain: 'marialais.com.br', url: 'https://marialais.com.br', status: 'publicado' } as any);
  await db.insert('sites', { client_id: C.rota, name: 'rotadaspousadas.com.br', template: 'institucional', domain: 'rotadaspousadas.com.br', url: 'https://rotadaspousadas.com.br', status: 'publicado' } as any);
  await db.insert('sites', { client_id: C.bny, name: 'app.bandanovayork.com.br', template: 'links-mobile', domain: 'app.bandanovayork.com.br', url: 'https://app.bandanovayork.com.br', status: 'publicado' } as any);
  await db.insert('sites', { client_id: C.felipe, name: 'Landing page Felipe Vox', template: 'artista-landing', status: 'briefing' } as any);

  // Agenda
  const events = [
    { title: 'Baile da Tia Cíntia · Bar Charles Edward (SP)', kind: 'entrega', starts_at: '2026-11-06T22:00:00-03:00', client_id: C.cintia },
    { title: 'Barzim de Rock · Castelli Master', kind: 'entrega', starts_at: '2026-11-07T22:00:00-03:00', client_id: C.gibson },
    { title: 'Reunião de direções · Banda Nova York', kind: 'reuniao', starts_at: d(5), client_id: C.bny },
    { title: 'Diária de captação · bastidores GIBSON', kind: 'diaria', starts_at: d(3), client_id: C.gibson },
    { title: 'Publicação · post AGENDA (Barzim)', kind: 'publicacao', starts_at: d(2), client_id: C.gibson },
  ];
  for (const e of events) await db.insert('events', e as any);

  // Workflows padrão
  const workflows = [
    ['Cliente novo → diagnóstico', 'Questionário concluído', 'Gerar diagnóstico, serviços recomendados e rascunho de proposta'],
    ['Proposta aceita → contrato', 'Proposta marcada como aceita', 'Gerar contrato a partir da proposta e enviar para assinatura'],
    ['Contrato assinado → projeto e faturas', 'Contrato assinado', 'Criar projetos do escopo e faturas 50/50 ou mensais (dia 10)'],
    ['Lote aprovado → agendamento', 'Lote de feed aprovado no portal', 'Agendar publicações e avisar o responsável'],
    ['Campanha encerrada → relatório final', 'Data de fim da campanha', 'Enviar relatório final e criar tarefa de renovação'],
    ['Dia 1 → calendário do mês', 'Todo dia 1', 'Gerar calendário editorial para clientes com plano de conteúdo'],
  ] as const;
  for (const [name, trigger, action] of workflows) await db.insert('workflows', { name, trigger, action, active: true } as any);

  // Notificações e histórico
  const notes = [
    { user_id: VITOR, kind: 'aprovacao', title: 'GIBSON: 4 peças do lote 1 aguardam sua aprovação', link: '/aprovacoes' },
    { user_id: VITOR, kind: 'financeiro', title: 'Fatura da Rota das Pousadas venceu há 3 dias', link: '/financeiro' },
    { user_id: YURI, kind: 'job', title: 'Reel 04 do Dino está renderizando no seu Mac', link: '/marketing/videos' },
    { user_id: PEDRO, kind: 'vendas', title: 'Follow-up D+5 da Clínica Inti venceu ontem', link: '/vendas' },
    { user_id: MARCOS, kind: 'projeto', title: 'Questionário de contratação do site GIBSON: prazo em 4 dias', link: '/projects' },
  ];
  for (const n of notes) await db.insert('notifications', n as any);
  const acts = [
    { actor_id: VITOR, actor_name: 'Vitor', action: 'aprovou 2 peças do Feed GIBSON · lote 1', entity: 'content_plans', entity_id: plan.id },
    { actor_id: YURI, actor_name: 'Yuri', action: 'enviou o Reel 03 do Dino para revisão', entity: 'video_projects' },
    { actor_id: PEDRO, actor_name: 'Pedro Paulo', action: 'enviou a proposta 2026-046 para Felipe Vox', entity: 'quotes' },
    { actor_id: VITOR, actor_name: 'Vitor', action: 'ativou a campanha Baile da Tia Cíntia em SP', entity: 'campaigns', entity_id: CAMP.cintia },
    { actor_id: MARCOS, actor_name: 'Marcos', action: 'abriu o projeto da versão mobile do site GIBSON', entity: 'projects', entity_id: P.gibsonSite },
  ];
  for (const a of acts) await db.insert('activity_log', a as any);

  // Integrações
  await db.insert('integrations', { provider: 'supabase', scope: 'studio', status: db.mode === 'supabase' ? 'conectado' : 'pendente', connected_at: d(0) } as any);
  await db.insert('integrations', { provider: 'anthropic', scope: 'studio', status: 'pendente' } as any);
  await db.insert('integrations', { provider: 'meta', scope: 'studio', status: 'pendente' } as any);
  await db.insert('integrations', { provider: 'resend', scope: 'studio', status: 'pendente' } as any);
  await db.insert('integrations', { provider: 'apify', scope: 'studio', status: 'pendente' } as any);
  await db.insert('integrations', { provider: 'google_drive', scope: 'studio', status: 'pendente' } as any);
}
