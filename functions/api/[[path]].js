import { startRecipeGeneration, pollRecipeGeneration } from '../../shared/cursor-recipe.mjs';
import { buildNutritionProfile } from '../../shared/nutrition-profile.js';
import {
  getClientIpFromRequest,
  checkLoginRateLimit,
  recordLoginAttempt,
} from '../../shared/login-rate-limit.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

function fail(code, message, status = 400, extra = {}) {
  const { responseHeaders, ...errorExtra } = extra;
  return json({
    ok: false,
    error: {
      code,
      message,
      ...errorExtra,
    },
  }, status, responseHeaders || {});
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function ok(data, status = 200) {
  return json({ ok: true, data }, status);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeRecipe(record) {
  if (!record) return null;
  const normalized = clone(record);
  normalized.version = Number(normalized.version || 1);
  normalized.updatedAt = String(normalized.updatedAt || '').trim() || null;
  normalized.createdAt = String(normalized.createdAt || normalized.updatedAt || new Date().toISOString()).trim();
  normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
  normalized.tags = Array.isArray(normalized.tags) ? normalized.tags : [];
  normalized.statusTags = Array.isArray(normalized.statusTags) ? normalized.statusTags : [];
  normalized.summary = Array.isArray(normalized.summary) ? normalized.summary : [];
  normalized.meta = Array.isArray(normalized.meta) ? normalized.meta : [];
  normalized.ingredients = Array.isArray(normalized.ingredients) ? normalized.ingredients : [];
  normalized.steps = Array.isArray(normalized.steps) ? normalized.steps : [];
  normalized.nutrition = Array.isArray(normalized.nutrition) ? normalized.nutrition : [];
  normalized.tips = Array.isArray(normalized.tips) ? normalized.tips : [];
  normalized.ingredientNames = Array.isArray(normalized.ingredientNames)
    ? normalized.ingredientNames
    : normalized.ingredients.flatMap((group) => (group.items || []).map((item) => item.name));
  normalized.ingredientCount = Number(normalized.ingredientCount || normalized.ingredientNames.length);
  normalized.calories = {
    perServing: 0,
    total: 0,
    unit: '千卡',
    note: '',
    ...(normalized.calories || {}),
  };
  if (!normalized.nutritionProfile) {
    const profile = buildNutritionProfile(normalized);
    if (profile) normalized.nutritionProfile = profile;
  }
  return normalized;
}

function normalizeIngredient(record) {
  if (!record) return null;
  const normalized = clone(record);
  normalized.version = Number(normalized.version || 1);
  normalized.updatedAt = String(normalized.updatedAt || '').trim() || null;
  normalized.createdAt = String(normalized.createdAt || normalized.updatedAt || new Date().toISOString()).trim();
  normalized.aliases = Array.isArray(normalized.aliases) ? normalized.aliases : [];
  normalized.handlingTips = Array.isArray(normalized.handlingTips) ? normalized.handlingTips : [];
  normalized.storageTips = Array.isArray(normalized.storageTips) ? normalized.storageTips : [];
  normalized.cookingNotes = Array.isArray(normalized.cookingNotes) ? normalized.cookingNotes : [];
  normalized.nutritionPer100g = {
    protein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    ...(normalized.nutritionPer100g || {}),
  };
  normalized.caloriesPer100g = Number(normalized.caloriesPer100g || 0);
  return normalized;
}

function pickRecipeSummary(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    coverImage: recipe.coverImage,
    desc: recipe.desc,
    categories: recipe.categories,
    tags: recipe.tags,
    statusTags: recipe.statusTags,
    calories: recipe.calories,
    summary: recipe.summary,
    ingredientCount: recipe.ingredientCount,
    version: recipe.version,
    updatedAt: recipe.updatedAt,
  };
}

function pickIngredientSummary(ingredient) {
  return {
    id: ingredient.id,
    name: ingredient.name,
    aliases: ingredient.aliases,
    category: ingredient.category,
    unit: ingredient.unit,
    caloriesPer100g: ingredient.caloriesPer100g,
    version: ingredient.version,
    updatedAt: ingredient.updatedAt,
  };
}

function getToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return request.headers.get('X-Admin-Token') || '';
}

function getAdminConfig(env) {
  const adminPassword = String(env.ADMIN_PASSWORD || '').trim();
  const adminToken = String(env.ADMIN_TOKEN || '').trim();
  return {
    adminPassword,
    adminToken,
    configured: Boolean(adminPassword && adminToken),
  };
}

function isAdmin(request, env) {
  const { adminToken, configured } = getAdminConfig(env);
  if (!configured) return false;
  return getToken(request) === adminToken;
}

async function fetchJson(request, pathname) {
  const url = new URL(pathname, request.url);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to load ${pathname}: ${response.status}`);
  }
  return await response.json();
}

async function loadStore(request, env) {
  const kv = env.CONTENT_KV;
  if (kv) {
    const [recipes, ingredients] = await Promise.all([
      kv.get('recipes', 'json'),
      kv.get('ingredients', 'json'),
    ]);
    if (recipes && ingredients) {
      return { recipes, ingredients, source: 'kv' };
    }
  }

  const [recipes, ingredients] = await Promise.all([
    fetchJson(request, '/backend/storage/recipes.json'),
    fetchJson(request, '/backend/storage/ingredients.json'),
  ]);

  return { recipes, ingredients, source: 'seed' };
}

async function persistStore(env, recipes, ingredients) {
  const kv = env.CONTENT_KV;
  if (!kv) {
    const error = new Error('Cloudflare KV is not configured. Bind CONTENT_KV to enable saving edits.');
    error.code = 'KV_NOT_CONFIGURED';
    throw error;
  }

  await Promise.all([
    kv.put('recipes', JSON.stringify(recipes)),
    kv.put('ingredients', JSON.stringify(ingredients)),
  ]);
}

function updateVersion(current, incoming) {
  const currentVersion = Number(current.version || 1);
  const incomingVersion = Number(incoming.version || 0);
  const allowedVersions = new Set([currentVersion, currentVersion + 1]);
  if (!allowedVersions.has(incomingVersion)) {
    const error = new Error('Current version does not match the latest stored version');
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
}

function mergeRecipe(current, patch) {
  const next = normalizeRecipe({
    ...current,
    ...clone(patch),
    id: current.id,
    version: Number(current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    createdAt: current.createdAt,
  });
  next.ingredientNames = Array.isArray(next.ingredientNames)
    ? next.ingredientNames
    : next.ingredients.flatMap((group) => (group.items || []).map((item) => item.name));
  next.ingredientCount = Number(next.ingredientCount || next.ingredientNames.length);
  return next;
}

function mergeIngredient(current, patch) {
  return normalizeIngredient({
    ...current,
    ...clone(patch),
    id: current.id,
    version: Number(current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    createdAt: current.createdAt,
  });
}

async function handleCreateRecipe(request, env) {
  if (!isAdmin(request, env)) {
    return fail('FORBIDDEN', 'Admin permission required', 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400);
  }

  if (!payload || typeof payload !== 'object') {
    return fail('BAD_REQUEST', 'Body must be a JSON object', 400);
  }

  const id = String(payload.id || '').trim();
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return fail('BAD_REQUEST', 'Recipe id must use lowercase letters, numbers and hyphens', 400);
  }

  const store = await loadStore(request, env);
  if (store.recipes[id]) {
    return fail('ALREADY_EXISTS', 'Recipe id already exists', 409);
  }

  const next = normalizeRecipe({
    ...clone(payload),
    id,
    version: 1,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  next.ingredientNames = Array.isArray(next.ingredientNames)
    ? next.ingredientNames
    : next.ingredients.flatMap((group) => (group.items || []).map((item) => item.name));
  next.ingredientCount = Number(next.ingredientCount || next.ingredientNames.length);
  store.recipes[id] = next;

  try {
    await persistStore(env, store.recipes, store.ingredients);
  } catch (error) {
    if (error.code === 'KV_NOT_CONFIGURED') {
      return fail('KV_NOT_CONFIGURED', error.message, 503);
    }
    throw error;
  }

  return ok(next, 201);
}

async function handleDetail(request, env, type, id) {
  const store = await loadStore(request, env);
  const map = type === 'recipe' ? store.recipes : store.ingredients;
  const normalize = type === 'recipe' ? normalizeRecipe : normalizeIngredient;

  if (request.method === 'GET') {
    const record = map[id] ? normalize(map[id]) : null;
    if (!record) {
      return fail('NOT_FOUND', `${type} not found`, 404);
    }
    return ok(record);
  }

  if (request.method === 'PATCH') {
    if (!isAdmin(request, env)) {
      return fail('FORBIDDEN', 'Admin permission required', 403);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return fail('BAD_REQUEST', 'Invalid JSON body', 400);
    }

    if (!payload || typeof payload !== 'object') {
      return fail('BAD_REQUEST', 'Body must be a JSON object', 400);
    }

    const current = map[id];
    if (!current) {
      return fail('NOT_FOUND', `${type} not found`, 404);
    }

    try {
      updateVersion(current, payload);
      const next = type === 'recipe'
        ? mergeRecipe(current, payload)
        : mergeIngredient(current, payload);
      map[id] = next;
      await persistStore(env, store.recipes, store.ingredients);
      return ok(next);
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') {
        return fail('VERSION_CONFLICT', error.message, 409);
      }
      if (error.code === 'KV_NOT_CONFIGURED') {
        return fail('KV_NOT_CONFIGURED', error.message, 503);
      }
      return fail('BAD_REQUEST', error.message || 'Unable to save record', 400);
    }
  }

  if (request.method === 'DELETE') {
    if (!isAdmin(request, env)) {
      return fail('FORBIDDEN', 'Admin permission required', 403);
    }

    if (type !== 'recipe') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const current = map[id];
    if (!current) {
      return fail('NOT_FOUND', `${type} not found`, 404);
    }

    delete map[id];

    try {
      await persistStore(env, store.recipes, store.ingredients);
    } catch (error) {
      if (error.code === 'KV_NOT_CONFIGURED') {
        return fail('KV_NOT_CONFIGURED', error.message, 503);
      }
      throw error;
    }

    return ok({ id, deleted: true });
  }

  return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
}

function getRoutePath(params) {
  const raw = params?.path;
  if (Array.isArray(raw)) {
    return raw.join('/');
  }
  return String(raw || '').replace(/^\/+|\/+$/g, '');
}

async function handleGenerateRecipeStart(request, env) {
  if (!isAdmin(request, env)) {
    return fail('FORBIDDEN', 'Admin permission required', 403);
  }

  const apiKey = env.CURSOR_API_KEY;
  if (!apiKey) {
    return fail('CURSOR_NOT_CONFIGURED', '请在环境变量中配置 CURSOR_API_KEY', 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return fail('BAD_REQUEST', 'Invalid JSON body', 400);
  }

  const name = String(payload?.name || '').trim();
  const id = String(payload?.id || '').trim();
  if (!name) {
    return fail('BAD_REQUEST', '请提供菜名', 400);
  }
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return fail('BAD_REQUEST', '请提供合法菜谱 ID（小写字母、数字、连字符）', 400);
  }

  try {
    const started = await startRecipeGeneration(apiKey, name, id, {
      modelId: env.CURSOR_MODEL_ID,
    });
    return ok({ ...started, name, id }, 202);
  } catch (error) {
    if (error.code === 'CURSOR_NOT_CONFIGURED') {
      return fail('CURSOR_NOT_CONFIGURED', error.message, 503);
    }
    return fail('GENERATION_FAILED', error.message || '无法启动 AI 生成', 502);
  }
}

async function handleGenerateRecipeStatus(request, env) {
  if (!isAdmin(request, env)) {
    return fail('FORBIDDEN', 'Admin permission required', 403);
  }

  const apiKey = env.CURSOR_API_KEY;
  if (!apiKey) {
    return fail('CURSOR_NOT_CONFIGURED', '请在环境变量中配置 CURSOR_API_KEY', 503);
  }

  const url = new URL(request.url);
  const agentId = String(url.searchParams.get('agentId') || '').trim();
  const runId = String(url.searchParams.get('runId') || '').trim();
  const name = String(url.searchParams.get('name') || '').trim();
  const id = String(url.searchParams.get('id') || '').trim();

  if (!agentId || !runId || !name || !id) {
    return fail('BAD_REQUEST', '缺少 agentId、runId、name 或 id 参数', 400);
  }

  try {
    const result = await pollRecipeGeneration(apiKey, agentId, runId, name, id);
    return ok(result);
  } catch (error) {
    if (error.code === 'GENERATION_FAILED') {
      return fail('GENERATION_FAILED', error.message, 502);
    }
    return fail('GENERATION_FAILED', error.message || '查询生成状态失败', 502);
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const route = getRoutePath(params);
  const adminConfig = getAdminConfig(env);

  try {
    if (route === 'health' && request.method === 'GET') {
      return ok({
        status: 'ok',
        service: 'recipe-admin-backend',
        time: new Date().toISOString(),
        adminConfigured: adminConfig.configured,
      });
    }

    if (route === 'me' && request.method === 'GET') {
      return ok({
        isAdmin: isAdmin(request, env),
        tokenConfigured: adminConfig.configured,
      });
    }

    if (route === 'admin/login' && request.method === 'POST') {
      if (!adminConfig.configured) {
        return fail(
          'SERVICE_MISCONFIGURED',
          '管理员凭据未配置，请在 Cloudflare 环境变量中设置 ADMIN_PASSWORD 和 ADMIN_TOKEN',
          503,
        );
      }

      const clientIp = getClientIpFromRequest(request, 'unknown');
      const rateCheck = await checkLoginRateLimit(env.CONTENT_KV, clientIp);
      if (!rateCheck.allowed) {
        return fail(
          'RATE_LIMITED',
          `登录过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
          429,
          {
            retryAfterSeconds: rateCheck.retryAfterSeconds,
            responseHeaders: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
          },
        );
      }
      await recordLoginAttempt(env.CONTENT_KV, clientIp);

      let payload;
      try {
        payload = await request.json();
      } catch {
        return fail('BAD_REQUEST', 'Invalid JSON body', 400);
      }

      const password = String(payload?.password || '');
      if (password !== adminConfig.adminPassword) {
        return fail('FORBIDDEN', 'Password incorrect', 403);
      }

      return ok({
        token: adminConfig.adminToken,
        user: {
          id: 'admin',
          name: '管理员',
          role: 'admin',
        },
      });
    }

    if (route === 'admin/logout' && request.method === 'POST') {
      return ok({ loggedOut: true });
    }

    if (route === 'search-index' && request.method === 'GET') {
      const store = await loadStore(request, env);
      const recipes = Object.values(store.recipes).map((item) => pickRecipeSummary(normalizeRecipe(item)));
      const ingredients = Object.values(store.ingredients).map((item) => pickIngredientSummary(normalizeIngredient(item)));
      return ok({
        categories: [
          { id: 'all', label: '全部' },
          { id: 'breakfast', label: '早餐' },
          { id: 'lunch', label: '午餐' },
          { id: 'dinner', label: '晚餐' },
          { id: 'light', label: '减脂' },
          { id: 'quick', label: '快手' },
        ],
        searchHints: ['鸡胸', '牛肉', '沙拉', '番茄', '减脂'],
        defaultRecipeId: recipes[0]?.id || '',
        recipes,
        ingredients,
      });
    }

    if (route === 'recipes/generate/status' && request.method === 'GET') {
      return handleGenerateRecipeStatus(request, env);
    }

    if (route === 'recipes/generate' && request.method === 'POST') {
      return handleGenerateRecipeStart(request, env);
    }

    if (route === 'recipes' && request.method === 'POST') {
      return handleCreateRecipe(request, env);
    }

    if (route === 'recipes' && request.method === 'GET') {
      const store = await loadStore(request, env);
      const recipes = Object.values(store.recipes).map((item) => pickRecipeSummary(normalizeRecipe(item)));
      return ok(recipes);
    }

    if (route === 'ingredients' && request.method === 'GET') {
      const store = await loadStore(request, env);
      const ingredients = Object.values(store.ingredients).map((item) => pickIngredientSummary(normalizeIngredient(item)));
      return ok(ingredients);
    }

    const recipeMatch = route.match(/^recipes\/([^/]+)$/);
    if (recipeMatch) {
      return handleDetail(request, env, 'recipe', decodeURIComponent(recipeMatch[1]));
    }

    const ingredientMatch = route.match(/^ingredients\/([^/]+)$/);
    if (ingredientMatch) {
      return handleDetail(request, env, 'ingredient', decodeURIComponent(ingredientMatch[1]));
    }

    return fail('NOT_FOUND', 'Not found', 404);
  } catch (error) {
    console.error(error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
