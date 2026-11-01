import type { CookieOptions } from '@supabase/ssr';

export const REMEMBER_SESSION_COOKIE = 'bsv-remember-session';
export const REMEMBER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function rememberSessionCookieOptions(options: CookieOptions, rememberSession: boolean): CookieOptions {
  if (options.maxAge === 0) return options;
  const { maxAge: _maxAge, expires: _expires, ...sessionOptions } = options;
  return rememberSession ? { ...sessionOptions, maxAge: REMEMBER_SESSION_MAX_AGE } : sessionOptions;
}