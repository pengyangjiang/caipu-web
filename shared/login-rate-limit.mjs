export const LOGIN_COOLDOWN_MS = 30_000;

const memoryStore = new Map();

export function getClientIpFromRequest(request, fallback = 'unknown') {
  const headers = request.headers;
  const get = typeof headers.get === 'function'
    ? (name) => headers.get(name)
    : (name) => headers[name] || headers[name.toLowerCase()];

  const cfIp = get('CF-Connecting-IP');
  if (cfIp) return String(cfIp).trim();

  const xff = get('X-Forwarded-For');
  if (xff) return String(xff).split(',')[0].trim();

  const xri = get('X-Real-IP');
  if (xri) return String(xri).trim();

  return fallback;
}

export function checkLoginRateLimitMemory(ip, now = Date.now()) {
  const last = memoryStore.get(ip) || 0;
  const elapsed = now - last;
  if (last && elapsed < LOGIN_COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((LOGIN_COOLDOWN_MS - elapsed) / 1000),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginAttemptMemory(ip, now = Date.now()) {
  memoryStore.set(ip, now);
}

export async function checkLoginRateLimit(kv, ip) {
  if (kv) {
    const key = `login-rate:${ip}`;
    const raw = await kv.get(key);
    if (raw) {
      const last = Number(raw);
      const elapsed = Date.now() - last;
      if (elapsed < LOGIN_COOLDOWN_MS) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((LOGIN_COOLDOWN_MS - elapsed) / 1000),
        };
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return checkLoginRateLimitMemory(ip);
}

export async function recordLoginAttempt(kv, ip) {
  const now = Date.now();
  if (kv) {
    await kv.put(`login-rate:${ip}`, String(now), {
      expirationTtl: Math.ceil(LOGIN_COOLDOWN_MS / 1000),
    });
    return;
  }
  recordLoginAttemptMemory(ip, now);
}
