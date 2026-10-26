import type { MetadataRoute } from 'next';

/** Permite instalar o Impacto como app pelo Edge ou Chrome (Windows, Mac, Android). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Impacto · Studio Impacto',
    short_name: 'Impacto',
    description: 'Sistema do Studio Impacto: clientes, marca, feed, vídeo, tráfego, vendas e financeiro.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
