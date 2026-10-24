/**
 * Questionário de diagnóstico do Studio Impacto (10 blocos + variações por nicho).
 * Linguagem didática: quem responde é o cliente, com o comercial do lado ou pelo link público.
 */

export type QType = 'single' | 'multi' | 'text' | 'long' | 'scale' | 'number' | 'url' | 'date';

export type Question = {
  id: string;
  label: string;
  hint?: string;
  type: QType;
  options?: string[];
  showIf?: { id: string; in: string[] };
  reveals: string; // o que a resposta revela para o diagnóstico
};

export type Block = { id: string; title: string; intro: string; questions: Question[]; niche?: string[] };

const S = (id: string, label: string, options: string[], reveals: string, hint?: string, showIf?: Question['showIf']): Question => ({ id, label, type: 'single', options, reveals, hint, showIf });
const M = (id: string, label: string, options: string[], reveals: string, hint?: string): Question => ({ id, label, type: 'multi', options, reveals, hint });
const T = (id: string, label: string, reveals: string, hint?: string, showIf?: Question['showIf']): Question => ({ id, label, type: 'text', reveals, hint, showIf });
const L = (id: string, label: string, reveals: string, hint?: string, showIf?: Question['showIf']): Question => ({ id, label, type: 'long', reveals, hint, showIf });
const SC = (id: string, label: string, reveals: string, hint?: string): Question => ({ id, label, type: 'scale', reveals, hint });

export const QUESTIONNAIRE: Block[] = [
  {
    id: 'A',
    title: 'O negócio hoje',
    intro: 'Queremos entender o que você vende, para quem e onde está o crescimento.',
    questions: [
      S('A1', 'Há quanto tempo a empresa existe?', ['Menos de 1 ano', '1 a 3 anos', '3 a 10 anos', 'Mais de 10 anos'], 'Maturidade'),
      T('A2', 'O que vocês mais vendem hoje e quanto custa, em média?', 'Ticket e carro-chefe', 'Ex.: "show acústico de 2 h, R$ 6.000"'),
      T('A3', 'Qual produto ou serviço vocês querem vender mais nos próximos meses?', 'Foco de campanha'),
      S('A4', 'Onde estão seus clientes?', ['Só na cidade', 'Na região (até 100 km)', 'No estado', 'No Brasil todo'], 'Praça de tráfego'),
      L('A5', 'Quem é o cliente ideal? Descreva uma pessoa real que compra de vocês.', 'Persona', 'Idade, o que faz, o que busca, como decide'),
      S('A6', 'Quem decide a compra é a mesma pessoa que usa o produto?', ['Sim', 'Não'], 'Público de decisão'),
      S('A7', 'Quantos clientes novos vocês recebem por mês, mais ou menos?', ['Até 5', '5 a 20', '20 a 50', 'Mais de 50', 'Não sei'], 'Linha de base'),
      T('A8', 'Qual seria um bom resultado daqui a 90 dias, em número?', 'Meta', 'Ex.: "10 shows fechados", "40 orçamentos por mês"'),
    ],
  },
  {
    id: 'B',
    title: 'Como o cliente chega até vocês',
    intro: 'Aqui descobrimos o caminho real entre o primeiro contato e a compra.',
    questions: [
      M('B1', 'Hoje, de onde vem a maioria dos clientes?', ['Indicação', 'Instagram', 'Google', 'Anúncio pago', 'WhatsApp', 'Passagem na loja', 'Eventos', 'Marketplace', 'Outro'], 'Canais'),
      S('B2', 'A empresa vende ou fecha negócio pelas redes sociais hoje?', ['Sim, com frequência', 'Às vezes', 'Não'], 'Conversão social'),
      L('B3', 'Se sim: qual o caminho? (vê o post, chama no direct, vai para o WhatsApp, compra no site…)', 'Funil atual', undefined, { id: 'B2', in: ['Sim, com frequência', 'Às vezes'] }),
      S('B4', 'Quanto tempo leva entre o primeiro contato e a compra?', ['Mesmo dia', 'Alguns dias', 'Semanas', 'Meses'], 'Ciclo de venda'),
      T('B5', 'Quem responde as mensagens e em quanto tempo?', 'Gargalo de atendimento'),
      SC('B6', 'Vocês perdem vendas por demora no atendimento ou falta de retorno?', 'Dor de processo', '1 = nunca · 5 = sempre'),
    ],
  },
  {
    id: 'C',
    title: 'CRM e organização comercial',
    intro: 'Sem medir, não dá para melhorar. Vamos ver como a venda é acompanhada.',
    questions: [
      S('C1', 'Vocês usam algum CRM ou sistema para acompanhar os clientes?', ['Sim, um CRM', 'Planilha', 'Caderno ou memória', 'Não'], 'Maturidade comercial'),
      T('C2', 'Se sim: qual? Ele é usado de verdade pelo time?', 'Adoção', undefined, { id: 'C1', in: ['Sim, um CRM', 'Planilha'] }),
      S('C3', 'Vocês sabem quantos orçamentos enviaram e quantos fecharam no último mês?', ['Sim', 'Mais ou menos', 'Não'], 'Medição'),
      S('C4', 'Existe um processo de follow-up depois do orçamento?', ['Sim', 'Às vezes', 'Não'], 'Vazamento de funil'),
      S('C5', 'Vocês têm lista de clientes antigos que poderiam comprar de novo?', ['Sim, mais de 500 contatos', 'Sim, até 500', 'Não'], 'Base para remarketing'),
    ],
  },
  {
    id: 'D',
    title: 'Tráfego pago',
    intro: 'Anúncio bom começa com conta arrumada e medição.',
    questions: [
      M('D1', 'Vocês já anunciaram ou anunciam hoje?', ['Instagram/Facebook', 'Google', 'TikTok', 'Nunca anunciamos'], 'Experiência'),
      S('D2', 'Quem cuida dos anúncios?', ['O próprio dono', 'Funcionário', 'Agência', 'Freelancer', 'Botão impulsionar', 'Ninguém'], 'Operação'),
      S('D3', 'Quanto investem por mês em anúncios, mais ou menos?', ['Nada', 'Até R$ 500', 'R$ 500 a 1.500', 'R$ 1.500 a 5.000', 'Acima de R$ 5.000'], 'Verba'),
      S('D4', 'Vocês sabem quanto custa cada cliente que vem do anúncio?', ['Sim', 'Não'], 'Medição'),
      L('D5', 'O resultado dos anúncios é bom, médio ou ruim? Por quê?', 'Dor de tráfego'),
      S('D6', 'O site ou a página tem pixel da Meta ou do Google instalado?', ['Sim', 'Não', 'Não sei'], 'Base técnica'),
      S('D7', 'A conta de anúncios está no nome da empresa e vocês têm acesso de administrador?', ['Sim', 'Não', 'Não sei'], 'Viabilidade de integração'),
    ],
  },
  {
    id: 'E',
    title: 'Redes sociais e conteúdo',
    intro: 'Recorrência vende. Vamos ver o que já existe.',
    questions: [
      M('E1', 'Quais redes a empresa usa hoje?', ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn', 'Google Meu Negócio', 'Nenhuma'], 'Presença'),
      S('E2', 'Com que frequência postam?', ['Todo dia', 'Algumas vezes por semana', 'Semanal', 'Irregular', 'Parado'], 'Recorrência'),
      S('E3', 'Quem produz os posts e vídeos hoje?', ['O próprio dono', 'Funcionário', 'Agência', 'Freelancer', 'Ninguém'], 'Operação'),
      T('E4', 'Vocês postam vídeos (Reels, TikTok, YouTube)? Quem grava e edita?', 'Capacidade de vídeo'),
      S('E5', 'Têm fotos e vídeos profissionais recentes da empresa, equipe ou produto?', ['Sim, bastante', 'Poucos', 'Não'], 'Banco de material'),
      T('E6', 'Qual post ou vídeo deu mais resultado até hoje? (cole o link)', 'Referência interna'),
      T('E7', 'Que perfis vocês admiram, do seu setor ou de fora?', 'Referência de estilo'),
    ],
  },
  {
    id: 'F',
    title: 'Agência ou fornecedor atual',
    intro: 'Se já existe alguém cuidando do marketing, queremos saber o que funciona e o que incomoda.',
    questions: [
      S('F1', 'Existe uma agência, social media ou freelancer cuidando do marketing hoje?', ['Sim', 'Não', 'Já teve'], 'Contexto competitivo'),
      M('F2', 'Se sim: o que ela entrega?', ['Posts', 'Vídeos', 'Tráfego', 'Site', 'Relatórios', 'Estratégia'], 'Escopo atual'),
      T('F3', 'O que funciona bem nessa parceria?', 'O que preservar', undefined, { id: 'F1', in: ['Sim', 'Já teve'] }),
      M('F4', 'O que incomoda?', ['Prazo', 'Qualidade', 'Resultado', 'Comunicação', 'Preço', 'Falta de estratégia', 'Conteúdo genérico'], 'Dor principal'),
      SC('F5', 'Vocês recebem relatórios e entendem o que está acontecendo?', 'Transparência', '1 = nada · 5 = tudo claro'),
      L('F6', 'Se já tiveram agência e saíram: por que saíram?', 'Objeções futuras', undefined, { id: 'F1', in: ['Já teve'] }),
    ],
  },
  {
    id: 'G',
    title: 'Site e presença no Google',
    intro: 'O site é o ponto final de quase toda campanha.',
    questions: [
      S('G1', 'A empresa tem site?', ['Sim', 'Não', 'Em construção'], 'Base'),
      SC('G2', 'Ele funciona bem no celular, carrega rápido e traz contatos?', 'Dor de site', '1 = não · 5 = sim, muito'),
      S('G3', 'Quem consegue atualizar o site hoje?', ['Nós mesmos', 'A agência', 'Um freelancer', 'Ninguém'], 'Dependência'),
      S('G4', 'O domínio e a hospedagem estão no nome da empresa? Vocês têm os acessos?', ['Sim', 'Não', 'Não sei'], 'Risco técnico'),
      T('G5', 'A empresa aparece no Google Maps com avaliações? Quantas, mais ou menos?', 'Reputação local'),
    ],
  },
  {
    id: 'H',
    title: 'Marca e identidade',
    intro: 'Marca é o que faz o cliente lembrar e escolher.',
    questions: [
      S('H1', 'A marca tem logo profissional em arquivo vetorial (PDF, AI, SVG)?', ['Sim', 'Só imagem (PNG/JPG)', 'Não'], 'Necessidade de branding'),
      S('H2', 'Existe manual da marca (cores, fontes, regras)?', ['Sim', 'Não'], 'Necessidade de brand book'),
      T('H3', 'Em uma frase, como a empresa quer ser lembrada?', 'Posicionamento'),
      T('H4', 'Três palavras que descrevem a marca. E três que ela nunca deveria parecer.', 'Tom de voz'),
      SC('H5', 'A identidade atual representa o tamanho e a qualidade da empresa hoje?', 'Dor de rebranding', '1 = não · 5 = totalmente'),
      L('H6', 'Quais são os 3 principais concorrentes? O que eles fazem melhor?', 'Pesquisa'),
    ],
  },
  {
    id: 'I',
    title: 'Prazos, verba e decisão',
    intro: 'Para montar o plano certo, precisamos de datas e limites reais.',
    questions: [
      T('I1', 'Existe alguma data importante? (lançamento, evento, temporada, inauguração)', 'Urgência real'),
      S('I2', 'Quanto a empresa pode investir por mês em marketing (serviço, sem contar anúncios)?', ['Até R$ 1.500', 'R$ 1.500 a 3.500', 'R$ 3.500 a 8.500', 'Acima de R$ 8.500'], 'Plano adequado'),
      T('I3', 'Quem aprova as peças e quanto tempo costuma levar?', 'Fluxo de aprovação'),
      L('I4', 'O que faria vocês considerarem este trabalho um sucesso?', 'Critério de sucesso'),
    ],
  },
  {
    id: 'J',
    title: 'Restrições e cuidados',
    intro: 'O que não pode faltar e o que não pode aparecer.',
    questions: [
      M('J1', 'O negócio segue regras de conselho ou órgão?', ['CFM', 'CFO', 'OAB', 'CRECI', 'Anvisa', 'Nenhum'], 'Compliance'),
      L('J2', 'Há temas, promessas ou palavras que não podem aparecer?', 'Lista de proibidos'),
      S('J3', 'Podemos usar fotos de clientes, pacientes ou funcionários? Existe autorização?', ['Sim', 'Parcial', 'Não'], 'Direito de imagem'),
      S('J4', 'Podemos citar a empresa como case do Studio Impacto no futuro?', ['Sim', 'Depois', 'Não'], 'Autorização de case'),
    ],
  },
  {
    id: 'N1',
    title: 'Artista e banda',
    intro: 'Perguntas específicas para quem vive de palco.',
    niche: ['Artista', 'Banda', 'Escritório musical', 'DJ'],
    questions: [
      M('N1a', 'Formatos de show disponíveis', ['Acústico', 'Banda completa', 'DJ', 'Voz e violão', 'Pocket'], 'Portfólio de formatos'),
      T('N1b', 'Cachê de referência por formato', 'Precificação'),
      M('N1c', 'Tipos de contratante que mais fecham', ['Corporativo', 'Prefeitura', 'Casamento', 'Bares', 'Festas', 'Formaturas'], 'Público-alvo'),
      T('N1d', 'Agenda dos próximos 90 dias (datas confirmadas)', 'Agenda'),
      T('N1e', 'DVD ou clipes com mais visualizações (links)', 'Prova social'),
      T('N1f', 'Números públicos aprovados (seguidores, visualizações)', 'Números aprovados'),
    ],
  },
  {
    id: 'N2',
    title: 'Saúde e odontologia',
    intro: 'Aqui tudo segue CFM e CFO.',
    niche: ['Odontologia', 'Saúde', 'Clínica', 'Médico'],
    questions: [
      T('N2a', 'Especialidades e procedimentos de entrada', 'Oferta'),
      S('N2b', 'Atende convênios?', ['Sim', 'Não', 'Alguns'], 'Modelo'),
      SC('N2c', 'Taxa de ocupação da agenda hoje', 'Capacidade', '1 = vazia · 5 = lotada'),
      T('N2d', 'Número de cadeiras ou salas', 'Capacidade'),
    ],
  },
  {
    id: 'N3',
    title: 'Jurídico',
    intro: 'Publicidade jurídica segue as regras da OAB.',
    niche: ['Jurídico', 'Advocacia'],
    questions: [T('N3a', 'Áreas de atuação', 'Oferta'), S('N3b', 'Perfil de cliente', ['Pessoa física', 'Pessoa jurídica', 'Ambos'], 'Público'), T('N3c', 'Ticket por tipo de causa', 'Precificação')],
  },
  {
    id: 'N4',
    title: 'Varejo e e-commerce',
    intro: 'Loja física, online ou as duas.',
    niche: ['Varejo', 'E-commerce', 'Loja'],
    questions: [T('N4a', 'Plataforma da loja online (se houver)', 'Base técnica'), T('N4b', 'Ticket médio e taxa de recompra', 'Economia'), T('N4c', 'Datas sazonais fortes', 'Calendário')],
  },
  {
    id: 'N5',
    title: 'Imobiliário',
    intro: 'Captação e venda.',
    niche: ['Imobiliário', 'Imobiliária', 'Corretor'],
    questions: [T('N5a', 'Tipo de imóvel e faixa de preço', 'Oferta'), S('N5b', 'Trabalha com lançamentos?', ['Sim', 'Não'], 'Modelo'), T('N5c', 'Como capta proprietários hoje?', 'Captação')],
  },
  {
    id: 'N6',
    title: 'Gastronomia',
    intro: 'Salão, delivery e eventos.',
    niche: ['Gastronomia', 'Restaurante', 'Bar'],
    questions: [S('N6a', 'Delivery', ['Próprio', 'Apps', 'Ambos', 'Não tem'], 'Canal'), T('N6b', 'Horários de pico e ticket por pessoa', 'Economia'), S('N6c', 'Faz eventos?', ['Sim', 'Não'], 'Oferta')],
  },
];

export const SEGMENTS = [
  'Artista', 'Banda', 'Escritório musical', 'DJ', 'Odontologia', 'Saúde', 'Clínica', 'Jurídico', 'Beleza', 'Gastronomia', 'Imobiliário', 'Varejo',
  'E-commerce', 'Serviços', 'Eventos', 'Educação', 'Turismo', 'Indústria', 'Tecnologia', 'Outro',
];

export function blocksFor(segment?: string | null) {
  return QUESTIONNAIRE.filter((b) => !b.niche || (segment && b.niche.some((n) => n.toLowerCase() === segment.toLowerCase())));
}

export function isVisible(q: Question, answers: Record<string, unknown>) {
  if (!q.showIf) return true;
  const v = answers[q.showIf.id];
  if (Array.isArray(v)) return v.some((x) => q.showIf!.in.includes(String(x)));
  return q.showIf.in.includes(String(v ?? ''));
}

/** Mapa de dores por frente (0 a 10) calculado só com as respostas, antes da IA. */
export function painMapFromAnswers(a: Record<string, unknown>) {
  const s = (id: string) => Number(a[id] || 0);
  const has = (id: string, v: string) => (Array.isArray(a[id]) ? (a[id] as string[]).includes(v) : a[id] === v);
  const pain = { comercial: 3, trafego: 3, conteudo: 3, video: 3, marca: 3, site: 3, atendimento: 3 };
  if (a['C1'] === 'Não' || a['C1'] === 'Caderno ou memória') pain.comercial += 4;
  if (a['C3'] === 'Não') pain.comercial += 2;
  if (a['C4'] === 'Não') pain.comercial += 1;
  if (has('D1', 'Nunca anunciamos')) pain.trafego += 3;
  if (a['D4'] === 'Não') pain.trafego += 2;
  if (a['D6'] !== 'Sim') pain.trafego += 1;
  if (a['D7'] !== 'Sim') pain.trafego += 1;
  if (a['E2'] === 'Parado' || a['E2'] === 'Irregular') pain.conteudo += 4;
  if (a['E3'] === 'Ninguém') pain.conteudo += 2;
  if (a['E5'] === 'Não') pain.video += 3;
  if (a['E5'] === 'Poucos') pain.video += 1;
  if (!a['E4'] || /não|nao/i.test(String(a['E4']))) pain.video += 2;
  if (a['H1'] !== 'Sim') pain.marca += 2;
  if (a['H2'] === 'Não') pain.marca += 2;
  if (s('H5') && s('H5') <= 2) pain.marca += 3;
  if (a['G1'] === 'Não') pain.site += 5;
  if (s('G2') && s('G2') <= 2) pain.site += 3;
  if (a['G4'] !== 'Sim') pain.site += 1;
  if (s('B6') >= 4) pain.atendimento += 4;
  if (a['B2'] === 'Não') pain.atendimento += 1;
  return Object.fromEntries(Object.entries(pain).map(([k, v]) => [k, Math.min(10, v)])) as Record<string, number>;
}

export function maturityIndex(pain: Record<string, number>) {
  const vals = Object.values(pain);
  const avg = vals.reduce((x, y) => x + y, 0) / Math.max(1, vals.length);
  return Math.round(100 - avg * 10);
}

export const PAIN_LABEL: Record<string, string> = {
  comercial: 'Comercial / CRM',
  trafego: 'Tráfego',
  conteudo: 'Conteúdo',
  video: 'Vídeo',
  marca: 'Marca',
  site: 'Site',
  atendimento: 'Atendimento',
};
