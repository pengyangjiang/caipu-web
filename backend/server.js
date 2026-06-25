const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createStore } = require('./store');

const store = createStore();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'demo-admin-token';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ROOT_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  });
  res.end(text);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });

  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.headers['x-admin-token'] || '').trim();
}

function isAdmin(req) {
  return getToken(req) === ADMIN_TOKEN;
}

function notFound(res, message = 'Not found') {
  sendJson(res, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message,
    },
  });
}

function conflict(res, message = 'Version conflict') {
  sendJson(res, 409, {
    ok: false,
    error: {
      code: 'VERSION_CONFLICT',
      message,
    },
  });
}

function forbidden(res, message = 'Forbidden') {
  sendJson(res, 403, {
    ok: false,
    error: {
      code: 'FORBIDDEN',
      message,
    },
  });
}

function badRequest(res, message = 'Bad request') {
  sendJson(res, 400, {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message,
    },
  });
}

function ok(res, data, statusCode = 200) {
  sendJson(res, statusCode, { ok: true, data });
}

function handleCollection(res, type) {
  if (type === 'recipe') {
    ok(res, store.listRecipes());
    return;
  }

  ok(res, store.listIngredients());
}

async function handleDetail(req, res, type, id) {
  if (req.method === 'GET') {
    const record = type === 'recipe' ? store.getRecipe(id) : store.getIngredient(id);
    if (!record) {
      notFound(res, `${type} not found`);
      return;
    }
    ok(res, record);
    return;
  }

  if (req.method === 'PATCH') {
    if (!isAdmin(req)) {
      forbidden(res, 'Admin permission required');
      return;
    }

    let payload;
    try {
      payload = await readBody(req);
    } catch {
      badRequest(res, 'Invalid JSON body');
      return;
    }

    if (!payload || typeof payload !== 'object') {
      badRequest(res, 'Body must be a JSON object');
      return;
    }

    try {
      const updated = type === 'recipe'
        ? store.updateRecipe(id, payload)
        : store.updateIngredient(id, payload);
      ok(res, updated);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        notFound(res, error.message);
        return;
      }
      if (error.code === 'VERSION_CONFLICT') {
        conflict(res, error.message);
        return;
      }
      badRequest(res, error.message || 'Unable to save record');
    }
    return;
  }

  sendText(res, 405, 'Method Not Allowed');
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    });
    res.end();
    return;
  }

  if (pathname === '/health') {
    ok(res, {
      status: 'ok',
      service: 'recipe-admin-backend',
      time: new Date().toISOString(),
    });
    return;
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    ok(res, {
      isAdmin: isAdmin(req),
      tokenConfigured: Boolean(ADMIN_TOKEN),
    });
    return;
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    let payload;
    try {
      payload = await readBody(req);
    } catch {
      badRequest(res, 'Invalid JSON body');
      return;
    }

    const password = String(payload?.password || '');
    if (password !== ADMIN_PASSWORD) {
      forbidden(res, 'Password incorrect');
      return;
    }

    ok(res, {
      token: ADMIN_TOKEN,
      user: {
        id: 'admin',
        name: '管理员',
        role: 'admin',
      },
    });
    return;
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    ok(res, { loggedOut: true });
    return;
  }

  if (pathname === '/api/search-index' && req.method === 'GET') {
    ok(res, store.getSearchIndex());
    return;
  }

  if (pathname === '/api/recipes' && req.method === 'GET') {
    handleCollection(res, 'recipe');
    return;
  }

  if (pathname === '/api/ingredients' && req.method === 'GET') {
    handleCollection(res, 'ingredient');
    return;
  }

  const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
  if (recipeMatch) {
    await handleDetail(req, res, 'recipe', decodeURIComponent(recipeMatch[1]));
    return;
  }

  const ingredientMatch = pathname.match(/^\/api\/ingredients\/([^/]+)$/);
  if (ingredientMatch) {
    await handleDetail(req, res, 'ingredient', decodeURIComponent(ingredientMatch[1]));
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/')) {
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(ROOT_DIR, `.${safePath}`);

    if (!filePath.startsWith(ROOT_DIR)) {
      notFound(res);
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      if (req.method === 'HEAD') {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
      }

      sendFile(res, filePath);
      return;
    }
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });
});

server.listen(PORT, () => {
  console.log(`Content admin backend listening on http://localhost:${PORT}`);
});
