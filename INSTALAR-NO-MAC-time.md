# Impacto · instalar no Mac (time)

App para macOS do sistema operacional do Studio Impacto (CRM, marketing, tráfego, marca, vídeo, vendas, financeiro). Já vem conectado ao banco do Studio (Supabase).

### Instalar
1. Peça ao Vitor o .zip do seu Mac: **apple-silicon** (M1, M2, M3, M4) ou **intel**.
2. Dê dois cliques no .zip e arraste **Impacto.app** para a pasta **Aplicativos**.
3. Como o app ainda não é assinado pela Apple, no primeiro clique o macOS avisa que "não foi possível verificar o desenvolvedor". Abra o **Terminal** e cole:
   `xattr -cr "/Applications/Impacto.app" && codesign --force --deep --sign - "/Applications/Impacto.app"`
   (o primeiro tira a trava de "baixado da internet"; o segundo assina o app no seu Mac. Sem isso o macOS diz que o app "está danificado".)
   Depois abra o app normalmente (ou vá em Ajustes do Sistema → Privacidade e Segurança → "Abrir mesmo assim").

### Entrar
Usuário **VITOR**, **MARCOS**, **PEDROPAULO** ou **YURI** · senha inicial `impacto2026` (troque em *User*).

### Na web
A mesma plataforma roda na Vercel (link enviado pelo Vitor), com os mesmos usuários e os mesmos dados. O app no Mac é o mais completo (PDF do brandbook em um clique); na web, o PDF sai pela caixa de impressão do navegador ("Salvar como PDF").

### Observações
- Chaves de IA (Claude e ChatGPT) são configuradas uma vez em *Settings → Integrações* por quem for admin e valem para todo o time, no app e na web.
- Arquivos enviados ficam no Supabase Storage do Studio, visíveis para todos; para vídeos muito grandes, use o link do Google Drive.
