export function matchesAppOrigin(request: Request, appUrl?: string) {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    const expected = new URL(appUrl || request.url);
    const actual = new URL(source);
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    return actual.origin === expected.origin || (
      loopback.has(actual.hostname) && loopback.has(expected.hostname) &&
      actual.protocol === expected.protocol && actual.port === expected.port
    );
  } catch {
    return false;
  }
}