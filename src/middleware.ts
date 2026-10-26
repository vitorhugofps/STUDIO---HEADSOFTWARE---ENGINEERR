import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login', '/aprovar', '/api/health', '/api/files', '/manifest.webmanifest', '/icon'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anon) {
    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: any }[]) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const login = req.nextUrl.clone();
      login.pathname = '/login';
      login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
    return res;
  }

  if (!req.cookies.get('ihs_session')) {
    const login = req.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|images|download|manifest.webmanifest|api/upload|api/files|api/health|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|exe)).*)'],
};
