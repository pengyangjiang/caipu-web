export const LOGIN_COOLDOWN_MS = 30_000;
const KV_MIN_EXPIRATION_TTL = 60;

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
    try {
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
    } catch {
      return checkLoginRateLimitMemory(ip);
    }
  }

  return checkLoginRateLimitMemory(ip);
}

export async function recordLoginAttempt(kv, ip) {
  const now = Date.now();
  if (kv) {
    try {
      await kv.put(`login-rate:${ip}`, String(now), {
        // Cloudflare KV 要求 expirationTtl >= 60；实际冷却仍以 LOGIN_COOLDOWN_MS 为准
        expirationTtl: KV_MIN_EXPIRATION_TTL,
      });
      return;
    } catch {
      recordLoginAttemptMemory(ip, now);
      return;
    }
  }
  recordLoginAttemptMemory(ip, now);
}
