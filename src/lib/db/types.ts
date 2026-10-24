/**
 * Tipos das tabelas do IMPACTO HEADSOFTWARE.
 * O mesmo esquema vale para o modo Supabase (supabase/migrations) e para o modo local (.data/db.json).
 */

export type Role = 'admin' | 'developer' | 'comercial' | 'editor' | 'freelancer' | 'cliente';

export type Base = { id: string; created_at: string; updated_at?: string };

export type Profile = Base & {
  username: string;
  full_name: string;
  role: Role;
  title?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  preferences?: Record<string, unknown> | null;
  password_hash?: string | null; // só no modo local
};

export type ClientStatus = 'lead' | 'diagnostico' | 'proposta' | 'ativo' | 'pausado' | 'encerrado' | 'perdido';

export type Client = Base & {
  contact_name: string;
  company?: string | null;
  segment?: string | null;
  city?: string | null;
  state?: string | null;
  who_is?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  owner_id?: string | null;
  status: ClientStatus;
  health?: 'verde' | 'amarelo' | 'vermelho' | null;
  website?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  report_emails?: string[] | null;
  socials?: { rede: string; url: string }[] | null;
  name_use_authorized?: boolean | null;
  case_authorized?: boolean | null;
  maturity_index?: number | null;
  meta_ad_account_id?: string | null;
};

export type ClientContext = Base & {
  client_id: string;
  version: number;
  blocks: Record<string, string>;
  ai_summary?: string | null;
  created_by?: string | null;
};

export type QuestionnaireResponse = Base & {
  client_id: string;
  answers: Record<string, unknown>;
  answered_by?: string | null;
  public_token?: string | null;
  completed_at?: string | null;
};

export type Diagnosis = Base & {
  client_id: string;
  summary?: string | null;
  pain_map: Record<string, number>;
  findings: { title: string; detail: string; severity?: 'alta' | 'media' | 'baixa' }[];
  recommended_services: { front: string; service: string; why: string; priority: number }[];
  recommended_plan?: string | null;
  pending_items: string[];
  is_example?: boolean;
};

export type Asset = Base & {
  client_id?: string | null;
  project_id?: string | null;
  kind: string;
  name: string;
  path?: string | null;
  url?: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  tags?: string[] | null;
  analysis?: Record<string, unknown> | null;
  source?: string | null;
  created_by?: string | null;
};

export type BrandKit = Base & {
  client_id: string;
  mode: 'zero' | 'rebranding' | 'refresh' | 'importado';
  version: number;
  step: number;
  diagnosis?: Record<string, unknown> | null;
  strategy?: Record<string, unknown> | null;
  verbal?: Record<string, unknown> | null;
  visual?: Record<string, unknown> | null;
  tokens?: Record<string, unknown> | null;
  applications?: Record<string, unknown> | null;
  locked_fields?: string[] | null;
  status: 'rascunho' | 'em_aprovacao' | 'aprovado';
  approved_at?: string | null;
};

export type ProjectKind = 'feed' | 'reels' | 'video_horizontal' | 'motion' | 'trafego' | 'brand' | 'site' | 'landing' | 'impresso' | 'evento' | 'outro';
export type MethodStage = 'ponto' | 'roteiro' | 'set' | 'estreia' | 'temporada';

export type Project = Base & {
  client_id: string;
  kind: ProjectKind;
  title: string;
  method_stage: MethodStage;
  status: 'ativo' | 'aguardando_aprovacao' | 'pausado' | 'finalizado';
  progress: number;
  starts_on?: string | null;
  due_on?: string | null;
  owner_id?: string | null;
  brief?: Record<string, unknown> | null;
};

export type Task = Base & {
  project_id?: string | null;
  client_id?: string | null;
  title: string;
  description?: string | null;
  assignee_id?: string | null;
  status: 'a_fazer' | 'fazendo' | 'revisao' | 'feito';
  priority: number;
  due_at?: string | null;
};

export type ContentPlan = Base & {
  client_id: string;
  project_id?: string | null;
  month: string; // YYYY-MM
  goal?: string | null;
  mix?: Record<string, number> | null;
  series?: { name: string; goal: string; format: string }[] | null;
  status: 'rascunho' | 'em_aprovacao' | 'aprovado';
};

export type ContentItem = Base & {
  plan_id: string;
  client_id: string;
  format: 'post_4x5' | 'carrossel' | 'story' | 'capa_reel';
  series?: string | null;
  hook: string;
  art?: { headline?: string; support?: string; cta?: string; cards?: string[]; palette?: string } | null;
  caption?: string | null;
  alt_text?: string | null;
  hashtags?: string[] | null;
  scheduled_at?: string | null;
  status: 'rascunho' | 'revisado' | 'em_aprovacao' | 'aprovado' | 'ajustar' | 'agendado' | 'publicado';
  version: number;
};

export type VideoProject = Base & {
  client_id: string;
  project_id?: string | null;
  line: 'reels' | 'horizontal';
  title: string;
  direction?: Record<string, unknown> | null;
  script?: { blocks: { t: string; label: string; speech: string; screen?: string; visual?: string }[] } | null;
  shot_list?: { block: string; source: string; note: string }[] | null;
  source_asset_ids?: string[] | null;
  status: 'rascunho' | 'roteiro' | 'edicao' | 'revisao' | 'aprovado' | 'entregue';
  target_duration_s?: number | null;
  aspect?: string | null;
};

export type Campaign = Base & {
  client_id: string;
  project_id?: string | null;
  name: string;
  objective?: string | null;
  funnel?: 'TOPO' | 'FUNDO' | 'AMBOS' | null;
  offer?: Record<string, unknown> | null;
  geo?: Record<string, unknown> | null;
  budget?: { total?: number; daily?: number; currency?: string } | null;
  starts_on?: string | null;
  ends_on?: string | null;
  kit_zero?: Record<string, unknown> | null;
  kits?: unknown[] | null;
  structure?: Record<string, unknown> | null;
  creative_ids?: string[] | null;
  meta_campaign_id?: string | null;
  status: 'rascunho' | 'kit_zero' | 'pronta' | 'pausada' | 'ativa' | 'encerrada';
};

export type CampaignMetric = Base & {
  campaign_id: string;
  day: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  cost_per_result?: number | null;
  hook_rate?: number | null;
};

export type ReportSubscription = Base & {
  client_id: string;
  campaign_id?: string | null;
  audience: 'interno' | 'cliente';
  emails: string[];
  frequency: 'diario' | 'semanal' | 'fim';
  send_hour: number;
  active: boolean;
};

export type Deal = Base & {
  client_id?: string | null;
  title: string;
  stage: 'lead' | 'qualificacao' | 'diagnostico' | 'proposta' | 'negociacao' | 'fechado' | 'perdido';
  value?: number | null;
  probability?: number | null;
  source?: string | null;
  lost_reason?: string | null;
  owner_id?: string | null;
  next_action_at?: string | null;
};

export type Quote = Base & {
  number: string;
  deal_id?: string | null;
  client_id?: string | null;
  data: Record<string, unknown>;
  total: number;
  monthly?: number | null;
  valid_until?: string | null;
  status: 'rascunho' | 'enviada' | 'vista' | 'aceita' | 'recusada' | 'expirada';
};

export type Contract = Base & {
  client_id?: string | null;
  quote_id?: string | null;
  title: string;
  kind: 'projeto' | 'recorrente' | 'parceria' | 'imagem' | 'case';
  body?: string | null;
  status: 'rascunho' | 'enviado' | 'assinado' | 'vencendo' | 'encerrado';
  signed_at?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  value?: number | null;
  monthly?: number | null;
};

export type Invoice = Base & {
  client_id?: string | null;
  contract_id?: string | null;
  description: string;
  amount: number;
  due_on: string;
  method?: 'pix' | 'boleto' | 'cartao' | 'transferencia' | null;
  status: 'aberta' | 'paga' | 'atrasada' | 'cancelada';
  paid_at?: string | null;
};

export type Expense = Base & {
  category: string;
  supplier?: string | null;
  amount: number;
  due_on?: string | null;
  paid_at?: string | null;
  client_id?: string | null;
  project_id?: string | null;
};

export type Job = Base & {
  kind: string;
  runner: 'cloud' | 'local_yuri' | 'local_vitor';
  client_id?: string | null;
  project_id?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  status: 'fila' | 'rodando' | 'revisao' | 'concluido' | 'erro' | 'cancelado';
  progress: number;
  log?: string | null;
  cost_brl?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type AgentRun = Base & {
  job_id?: string | null;
  client_id?: string | null;
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: 'ok' | 'erro' | 'exemplo';
};

export type Notification = Base & {
  user_id?: string | null;
  kind: string;
  title: string;
  link?: string | null;
  read_at?: string | null;
};

export type Activity = Base & {
  actor_id?: string | null;
  actor_name?: string | null;
  action: string;
  entity?: string | null;
  entity_id?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ApprovalBatch = Base & {
  client_id: string;
  title: string;
  item_type: 'content' | 'video' | 'brand' | 'quote' | 'campaign' | 'site';
  item_ids: string[];
  public_token: string;
  status: 'aberto' | 'aprovado' | 'ajustes' | 'expirado';
  expires_at?: string | null;
};

export type Approval = Base & {
  batch_id: string;
  item_id: string;
  decision: 'aprovado' | 'ajustar';
  comment?: string | null;
  decided_by?: string | null;
};

export type Integration = Base & {
  provider: string;
  scope: 'studio' | 'cliente';
  client_id?: string | null;
  config?: Record<string, unknown> | null;
  status: 'conectado' | 'pendente' | 'erro';
  connected_at?: string | null;
};

export type Competitor = Base & { client_id: string; name: string; instagram?: string | null; website?: string | null; notes?: string | null };

export type ResearchReport = Base & {
  client_id?: string | null;
  kind: string;
  title: string;
  findings: Record<string, unknown>;
  sources?: { title: string; url: string; date?: string }[] | null;
};

export type Site = Base & {
  client_id: string;
  project_id?: string | null;
  name: string;
  template?: string | null;
  repo?: string | null;
  domain?: string | null;
  url?: string | null;
  status: 'briefing' | 'design' | 'desenvolvimento' | 'qa' | 'publicado' | 'manutencao';
};

export type CalendarEvent = Base & {
  title: string;
  kind: 'reuniao' | 'diaria' | 'entrega' | 'publicacao' | 'outro';
  starts_at: string;
  ends_at?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  notes?: string | null;
};

export type Service = Base & {
  name: string;
  front: string;
  kind: 'projeto' | 'mensal' | 'avulso';
  base_price: number;
  recurring: boolean;
  description?: string | null;
};

export type Workflow = Base & { name: string; trigger: string; action: string; active: boolean };

export type Tables = {
  profiles: Profile;
  clients: Client;
  client_contexts: ClientContext;
  questionnaire_responses: QuestionnaireResponse;
  diagnoses: Diagnosis;
  assets: Asset;
  brand_kits: BrandKit;
  projects: Project;
  tasks: Task;
  content_plans: ContentPlan;
  content_items: ContentItem;
  video_projects: VideoProject;
  campaigns: Campaign;
  campaign_metrics_daily: CampaignMetric;
  report_subscriptions: ReportSubscription;
  deals: Deal;
  quotes: Quote;
  contracts: Contract;
  invoices: Invoice;
  expenses: Expense;
  jobs: Job;
  agent_runs: AgentRun;
  notifications: Notification;
  activity_log: Activity;
  approval_batches: ApprovalBatch;
  approvals: Approval;
  integrations: Integration;
  competitors: Competitor;
  research_reports: ResearchReport;
  sites: Site;
  events: CalendarEvent;
  services_catalog: Service;
  workflows: Workflow;
};

export type TableName = keyof Tables;

export type ListOptions<T> = {
  where?: Partial<Record<keyof T & string, unknown>>;
  orderBy?: keyof T & string;
  desc?: boolean;
  limit?: number;
};

export interface DB {
  mode: 'local' | 'supabase';
  list<K extends TableName>(table: K, opts?: ListOptions<Tables[K]>): Promise<Tables[K][]>;
  get<K extends TableName>(table: K, id: string): Promise<Tables[K] | null>;
  insert<K extends TableName>(table: K, row: Partial<Tables[K]>): Promise<Tables[K]>;
  update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Promise<Tables[K]>;
  remove<K extends TableName>(table: K, id: string): Promise<void>;
}

export const TABLES: TableName[] = [
  'profiles', 'clients', 'client_contexts', 'questionnaire_responses', 'diagnoses', 'assets', 'brand_kits', 'projects', 'tasks',
  'content_plans', 'content_items', 'video_projects', 'campaigns', 'campaign_metrics_daily', 'report_subscriptions', 'deals', 'quotes',
  'contracts', 'invoices', 'expenses', 'jobs', 'agent_runs', 'notifications', 'activity_log', 'approval_batches', 'approvals',
  'integrations', 'competitors', 'research_reports', 'sites', 'events', 'services_catalog', 'workflows',
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Head de Marketing e Engenharia',
  developer: 'System Developer',
  comercial: 'Comercial',
  editor: 'Editor de vídeo',
  freelancer: 'Freelancer',
  cliente: 'Cliente',
};

export const STAGE_LABEL: Record<MethodStage, string> = {
  ponto: 'Ponto',
  roteiro: 'Roteiro',
  set: 'Set',
  estreia: 'Estreia',
  temporada: 'Temporada',
};

export const KIND_LABEL: Record<ProjectKind, string> = {
  feed: 'Feed',
  reels: 'Reels',
  video_horizontal: 'Vídeo horizontal',
  motion: 'Motion',
  trafego: 'Tráfego',
  brand: 'Brand',
  site: 'Site',
  landing: 'Landing page',
  impresso: 'Impresso',
  evento: 'Evento',
  outro: 'Outro',
};

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  lead: 'Lead',
  diagnostico: 'Em diagnóstico',
  proposta: 'Proposta',
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
  perdido: 'Perdido',
};
