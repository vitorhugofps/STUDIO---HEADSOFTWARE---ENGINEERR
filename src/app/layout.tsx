import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import fs from 'node:fs';
import path from 'node:path';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Impacto', template: '%s · Impacto' },
  description: 'Sistema operacional do Studio Impacto: clientes, marketing, tráfego, marca, vídeo, vendas e financeiro.',
  applicationName: 'Impacto',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#0A0A0A', width: 'device-width', initialScale: 1 };

const themeScript = `(function(){try{var t=localStorage.getItem('ihs.theme');if(t==='light')document.documentElement.classList.add('light');if(navigator.userAgent.indexOf('Electron')>-1||window.ihs){document.documentElement.classList.add('electron')}}catch(e){}})();`;

const FOUN = ['SemiBold', 'Bold'].filter((w) => fs.existsSync(path.join(process.cwd(), 'public', 'fonts', `Foun-${w}.woff2`)));
const founCss = FOUN.map((w) => `@font-face{font-family:'Foun';src:url('/fonts/Foun-${w}.woff2') format('woff2');font-weight:${w === 'Bold' ? 700 : 600};font-display:swap}`).join('');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {founCss && <style dangerouslySetInnerHTML={{ __html: founCss }} />}
      </head>
      <body className="min-h-full antialiased">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: { toast: '!glass-strong !rounded-2xl !border-white/10 !text-ink !text-sm', description: '!text-ink2' },
          }}
        />
      </body>
    </html>
  );
}
