// Fail fast at boot if the deployment is misconfigured, instead of failing on the first request.
const WEAK = ['dev-only-change-me', 'dev-only-change-me-too', 'change-me', 'changeme'];

export function assertEnv() {
  const prod = process.env.NODE_ENV === 'production';
  const problems: string[] = [];

  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');

  const secret = process.env.JWT_SECRET || '';
  if (!secret) problems.push('JWT_SECRET is not set');
  else if (prod && (secret.length < 32 || WEAK.includes(secret.toLowerCase()))) {
    problems.push('JWT_SECRET must be a random value of at least 32 characters in production');
  }

  if (problems.length) {
    console.error('Invalid configuration:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}

// CORS: in production the app is served same-origin behind the load balancer, so cross-origin is OFF
// unless CORS_ORIGINS (comma separated) is given. In development anything is allowed.
export function corsOrigins(): boolean | string[] {
  const list = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  return process.env.NODE_ENV === 'production' ? false : true;
}
