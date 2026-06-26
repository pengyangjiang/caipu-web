(function () {
  const model = window.contentModel;
  const remoteBase = (
    window.APP_CONFIG?.apiBaseUrl
    || window.__API_BASE_URL__
    || window.API_BASE_URL
    || 'http://localhost:3000'
  ).trim();
  const hasRemote = Boolean(remoteBase);
  const storageKeys = {
    recipe: 'recipe-content-drafts',
    ingredient: 'ingredient-content-drafts',
  };
  const deletedRecipesKey = 'recipe-content-deleted';
  const deletedIngredientsKey = 'ingredient-content-deleted';

  if (!model) {
    throw new Error('contentModel 未加载，请先在 HTML 中引入 content-model.js');
  }

  function getSourceMap(type) {
    if (type === 'ingredient') return window.ingredientDetails || {};
    return window.recipeDetails || {};
  }

  function getAuthHeaders() {
    const token = window.localStorage.getItem('content-admin-token') || '';
    if (!token) {
      return {};
    }

    return {
      Authorization: `Bearer ${token}`,
      'X-Admin-Token': token,
    };
  }

  function getStorageKey(type) {
    return storageKeys[type];
  }

  function readDrafts(type) {
    try {
      return JSON.parse(localStorage.getItem(getStorageKey(type)) || '{}');
    } catch {
      return {};
    }
  }

  function writeDrafts(type, drafts) {
    localStorage.setItem(getStorageKey(type), JSON.stringify(drafts));
  }

  function readDeletedIngredientIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(deletedIngredientsKey) || '[]'));
    } catch {
      return new Set();
    }
  }

  function markIngredientDeleted(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    const deleted = readDeletedIngredientIds();
    deleted.add(normalizedId);
    localStorage.setItem(deletedIngredientsKey, JSON.stringify([...deleted]));
  }

  function isIngredientDeleted(id) {
    return readDeletedIngredientIds().has(String(id || '').trim());
  }

  function removeIngredientLocally(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;

    markIngredientDeleted(normalizedId);

    const drafts = readDrafts('ingredient');
    if (drafts[normalizedId]) {
      delete drafts[normalizedId];
      writeDrafts('ingredient', drafts);
    }

    const sourceMap = getSourceMap('ingredient');
    if (sourceMap[normalizedId]) {
      delete sourceMap[normalizedId];
    }

    if (window.recipeCatalog?.ingredients) {
      window.recipeCatalog.ingredients = window.recipeCatalog.ingredients.filter(
        (item) => item.id !== normalizedId,
      );
    }
  }

  function readDeletedRecipeIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(deletedRecipesKey) || '[]'));
    } catch {
      return new Set();
    }
  }

  function markRecipeDeleted(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    const deleted = readDeletedRecipeIds();
    deleted.add(normalizedId);
    localStorage.setItem(deletedRecipesKey, JSON.stringify([...deleted]));
  }

  function isRecipeDeleted(id) {
    return readDeletedRecipeIds().has(String(id || '').trim());
  }

  function removeRecipeLocally(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;

    markRecipeDeleted(normalizedId);

    const drafts = readDrafts('recipe');
    if (drafts[normalizedId]) {
      delete drafts[normalizedId];
      writeDrafts('recipe', drafts);
    }

    const sourceMap = getSourceMap('recipe');
    if (sourceMap[normalizedId]) {
      delete sourceMap[normalizedId];
    }

    if (window.recipeCatalog?.recipes) {
      window.recipeCatalog.recipes = window.recipeCatalog.recipes.filter(
        (item) => item.id !== normalizedId,
      );
    }
  }

  function unwrapResponse(payload) {
    if (!payload) {
      return null;
    }

    if (typeof payload === 'object' && payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return payload.data;
    }

    return payload;
  }

  async function request(path, options = {}) {
    if (!hasRemote) {
      throw new Error('Remote API is not configured.');
    }

    const response = await fetch(`${remoteBase}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error?.message || `Request failed: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.error?.code || null;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  }

  function pickLatestContent(records) {
    const valid = records.filter(Boolean);
    if (!valid.length) return null;

    return valid.sort((a, b) => {
      const versionDiff = Number(b.version || 0) - Number(a.version || 0);
      if (versionDiff !== 0) return versionDiff;

      const timeA = Date.parse(a.updatedAt || '') || 0;
      const timeB = Date.parse(b.updatedAt || '') || 0;
      if (timeB !== timeA) return timeB - timeA;

      return 0;
    })[0];
  }

  function pickRecipeSummary(recipe) {
    const normalized = model.normalize('recipe', recipe);
    return {
      id: normalized.id,
      name: normalized.name,
      coverImage: normalized.coverImage,
      desc: normalized.desc,
      categories: normalized.categories,
      tags: normalized.tags,
      statusTags: normalized.statusTags,
      calories: normalized.calories,
      summary: normalized.summary,
      ingredientNames: normalized.ingredientNames,
      ingredientCount: normalized.ingredientCount,
    };
  }

  let lastSaveTarget = 'local';
  let lastSaveFailure = '';
  let lastIngredientSync = null;

  function getLastSaveTarget() {
    return lastSaveTarget;
  }

  function getLastSaveFailure() {
    return lastSaveFailure;
  }

  function getLastIngredientSync() {
    return lastIngredientSync;
  }

  function pickIngredientListItem(ingredient) {
    const normalized = model.normalize('ingredient', ingredient);
    return {
      id: normalized.id,
      name: normalized.name,
      aliases: normalized.aliases,
      category: normalized.category,
      unit: normalized.unit,
      caloriesPer100g: normalized.caloriesPer100g,
      nutritionPer100g: normalized.nutritionPer100g,
    };
  }

  function hasIngredientNutrition(ingredient) {
    if (!ingredient) return false;
    const n = ingredient.nutritionPer100g || {};
    return Number(ingredient.caloriesPer100g || 0) > 0
      || Number(n.protein || 0) > 0
      || Number(n.fat || 0) > 0
      || Number(n.carbs || 0) > 0
      || Number(n.fiber || 0) > 0;
  }

  function mergeIngredientSnapshot(existing, incoming) {
    if (!incoming) return existing ? model.normalize('ingredient', existing) : null;
    if (!existing) return model.normalize('ingredient', incoming);

    const merged = { ...existing, ...incoming };
    if (!hasIngredientNutrition(incoming) && hasIngredientNutrition(existing)) {
      merged.caloriesPer100g = existing.caloriesPer100g;
      merged.nutritionPer100g = existing.nutritionPer100g;
    }

    for (const key of ['handlingTips', 'storageTips', 'cookingNotes']) {
      const existingTips = Array.isArray(existing[key]) ? existing[key].filter(Boolean) : [];
      const incomingTips = Array.isArray(incoming[key]) ? incoming[key].filter(Boolean) : [];
      if (!incomingTips.length) {
        merged[key] = existingTips;
      } else if (!existingTips.length) {
        merged[key] = incomingTips;
      } else {
        merged[key] = [...new Set([...existingTips, ...incomingTips])];
      }
    }

    return model.normalize('ingredient', merged);
  }

  function deriveRecipeIngredientNames(recipe) {
    if (Array.isArray(recipe?.ingredientNames) && recipe.ingredientNames.length) {
      return recipe.ingredientNames;
    }
    if (!Array.isArray(recipe?.ingredients)) return [];
    return recipe.ingredients.flatMap((group) => (
      (group.items || []).map((item) => item.name).filter(Boolean)
    ));
  }

  function mergeRecipeSnapshot(existing, incoming) {
    if (!incoming) return existing ? model.normalize('recipe', existing) : null;
    if (!existing) return model.normalize('recipe', incoming);

    const merged = { ...existing, ...incoming };
    const existingNames = deriveRecipeIngredientNames(existing);
    const incomingNames = deriveRecipeIngredientNames(incoming);

    if (!incomingNames.length && existingNames.length) {
      merged.ingredientNames = existingNames;
      merged.ingredientCount = Number(existing.ingredientCount || existingNames.length);
    } else if (incomingNames.length) {
      merged.ingredientNames = incomingNames;
      merged.ingredientCount = Number(incoming.ingredientCount || incomingNames.length);
    }

    if (!Array.isArray(merged.ingredients) || !merged.ingredients.length) {
      if (Array.isArray(existing.ingredients) && existing.ingredients.length) {
        merged.ingredients = existing.ingredients;
      }
    }

    return model.normalize('recipe', merged);
  }

  function upsertLocalIngredients(catalogItems, options = {}) {
    if (!Array.isArray(catalogItems) || !catalogItems.length) {
      return { created: [], updated: [], skipped: [] };
    }

    if (!window.ingredientSync?.upsertIngredientCatalog) {
      return { created: [], updated: [], skipped: catalogItems.map((item) => item?.name || 'unknown') };
    }

    const map = getSourceMap('ingredient');
    const result = window.ingredientSync.upsertIngredientCatalog(
      map,
      catalogItems,
      (item) => model.normalize('ingredient', item),
    );

    if (Array.isArray(options.recipeIngredientNames) && window.ingredientSync.linkRecipeNamesToCatalog) {
      window.ingredientSync.linkRecipeNamesToCatalog(map, options.recipeIngredientNames);
    }

    const drafts = readDrafts('ingredient');
    for (const item of Object.values(map)) {
      if (item?.id) {
        drafts[item.id] = item;
      }
    }
    writeDrafts('ingredient', drafts);

    if (window.recipeCatalog) {
      mergeCatalogIngredients(window.recipeCatalog, Object.values(map));
    }

    return result;
  }

  function applyRecipeIngredientLinks(recipeIngredientNames) {
    if (!Array.isArray(recipeIngredientNames) || !recipeIngredientNames.length) return;
    if (!window.ingredientSync?.linkRecipeNamesToCatalog) return;

    const map = getSourceMap('ingredient');
    window.ingredientSync.linkRecipeNamesToCatalog(map, recipeIngredientNames);

    const drafts = readDrafts('ingredient');
    for (const item of Object.values(map)) {
      if (item?.id) {
        drafts[item.id] = item;
      }
    }
    writeDrafts('ingredient', drafts);

    if (window.recipeCatalog) {
      mergeCatalogIngredients(window.recipeCatalog, Object.values(map));
    }
  }

  async function syncCatalogIngredients(catalog) {
    if (!catalog) return catalog;

    if (hasRemote) {
      try {
        const remoteList = await listIngredients();
        if (Array.isArray(remoteList)) {
          return mergeCatalogIngredients(catalog, remoteList, { remoteAuthoritative: true });
        }
      } catch {
        // fall back to bundled / draft data
      }
    }

    mergeCatalogIngredients(catalog, []);
    mergeCatalogIngredients(catalog, Object.values({ ...getSourceMap('ingredient'), ...readDrafts('ingredient') }));
    return catalog;
  }

  async function loadContent(type, id) {
    if (type === 'recipe' && isRecipeDeleted(id)) {
      return null;
    }
    if (type === 'ingredient' && isIngredientDeleted(id)) {
      return null;
    }

    const draft = readDrafts(type)[id] || null;
    const seedRecord = getSourceMap(type)[id] || null;
    let remoteRecord = null;
    let remoteMissing = false;

    if (hasRemote) {
      try {
        const path = type === 'recipe'
          ? `/api/recipes/${encodeURIComponent(id)}`
          : `/api/ingredients/${encodeURIComponent(id)}`;
        const data = unwrapResponse(await request(path));
        if (data) {
          remoteRecord = model.normalize(type, data);
        }
      } catch (error) {
        if (error.status === 404 || error.code === 'NOT_FOUND') {
          remoteMissing = true;
        }
        // fall back to draft / seed data when appropriate
      }
    }

    if (type === 'ingredient') {
      if (hasRemote) {
        if (remoteRecord) return remoteRecord;
        if (draft) return model.normalize(type, draft);
        if (remoteMissing) return null;
      }

      const candidates = [
        seedRecord ? model.normalize(type, seedRecord) : null,
        draft ? model.normalize(type, draft) : null,
        remoteRecord,
      ].filter(Boolean);
      if (!candidates.length) return null;
      return candidates.reduce((merged, item) => mergeIngredientSnapshot(merged, item), null);
    }

    if (hasRemote && type === 'recipe') {
      if (remoteRecord) return remoteRecord;
      if (draft) return model.normalize(type, draft);
      if (remoteMissing) return null;
    }

    return pickLatestContent([
      draft ? model.normalize(type, draft) : null,
      remoteRecord,
      seedRecord ? model.normalize(type, seedRecord) : null,
    ]);
  }

  async function saveContent(type, id, payload) {
    const normalized = model.normalize(type, {
      ...payload,
      id,
      version: Number(payload.version || model.defaultVersion) + 1,
      updatedAt: model.now(),
    });

    lastSaveTarget = 'local';
    lastSaveFailure = '';

    if (hasRemote) {
      try {
        const path = type === 'recipe'
          ? `/api/recipes/${encodeURIComponent(id)}`
          : `/api/ingredients/${encodeURIComponent(id)}`;
        const data = unwrapResponse(await request(path, {
          method: 'PATCH',
          body: JSON.stringify(normalized),
        }));
        lastSaveTarget = 'remote';
        return model.normalize(type, data || normalized);
      } catch (error) {
        if (error.code === 'KV_NOT_CONFIGURED') {
          lastSaveFailure = '服务器未配置 CONTENT_KV，无法在线持久化保存';
        } else if (error.code === 'VERSION_CONFLICT') {
          lastSaveFailure = '内容已被其他人修改，请刷新后重试';
        } else if (error.status === 403) {
          lastSaveFailure = '管理员权限失效，请重新登录';
        } else {
          lastSaveFailure = error.message || '服务器保存失败';
        }
        // fall through to local draft persistence
      }
    }

    const drafts = readDrafts(type);
    drafts[id] = normalized;
    writeDrafts(type, drafts);

    const sourceMap = getSourceMap(type);
    sourceMap[id] = normalized;

    return normalized;
  }

  async function createContent(type, id, payload) {
    if (type !== 'recipe') {
      throw new Error('当前仅支持新建菜谱');
    }

    const normalizedId = String(id || '').trim();
    const stripFn = window.ingredientSync?.stripIngredientCatalog;
    const { recipePayload, ingredientCatalog: rawCatalog } = stripFn
      ? stripFn(payload)
      : { recipePayload: payload, ingredientCatalog: [] };

    const normalized = model.normalize(type, {
      ...recipePayload,
      id: normalizedId,
      version: 1,
      updatedAt: model.now(),
    });

    let ingredientCatalog = Array.isArray(rawCatalog) ? rawCatalog : [];
    if (window.ingredientSync?.ensureRecipeIngredientCatalog) {
      ingredientCatalog = window.ingredientSync.ensureRecipeIngredientCatalog({
        ...normalized,
        ingredientCatalog,
      });
    }

    lastSaveTarget = 'local';
    lastSaveFailure = '';
    lastIngredientSync = null;

    if (hasRemote) {
      try {
        const response = unwrapResponse(await request('/api/recipes', {
          method: 'POST',
          body: JSON.stringify({ ...normalized, id: normalizedId, ingredientCatalog }),
        }));
        lastSaveTarget = 'remote';
        const recipe = model.normalize(type, response?.recipe || response);
        lastIngredientSync = response?.ingredientSync || null;
        if (ingredientCatalog.length) {
          upsertLocalIngredients(ingredientCatalog, {
            recipeIngredientNames: normalized.ingredientNames,
          });
        } else if (lastIngredientSync) {
          try {
            if (window.recipeCatalog) {
              await syncCatalogIngredients(window.recipeCatalog);
            }
            applyRecipeIngredientLinks(normalized.ingredientNames);
          } catch {
            // ignore refresh failure
          }
        } else {
          applyRecipeIngredientLinks(normalized.ingredientNames);
        }
        return recipe;
      } catch (error) {
        if (error.code === 'ALREADY_EXISTS' || error.code === 'INVALID_ID') {
          throw error;
        }
        if (error.code === 'KV_NOT_CONFIGURED') {
          lastSaveFailure = '服务器未配置 CONTENT_KV，无法在线持久化保存';
        } else if (error.status === 403) {
          lastSaveFailure = '管理员权限失效，请重新登录';
          throw error;
        } else {
          lastSaveFailure = error.message || '服务器创建失败';
        }
      }
    }

    const sourceMap = getSourceMap(type);
    const drafts = readDrafts(type);
    if (sourceMap[normalizedId] || drafts[normalizedId]) {
      const error = new Error('菜谱 ID 已存在');
      error.code = 'ALREADY_EXISTS';
      throw error;
    }

    drafts[normalizedId] = normalized;
    writeDrafts(type, drafts);
    sourceMap[normalizedId] = normalized;

    if (ingredientCatalog.length) {
      lastIngredientSync = upsertLocalIngredients(ingredientCatalog, {
        recipeIngredientNames: normalized.ingredientNames,
      });
    } else {
      applyRecipeIngredientLinks(normalized.ingredientNames);
    }

    return normalized;
  }

  async function deleteContent(type, id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new Error(type === 'ingredient' ? '缺少食材 ID' : '缺少菜谱 ID');
    }

    lastSaveTarget = 'local';
    lastSaveFailure = '';

    if (type === 'recipe') {
      if (hasRemote) {
        try {
          const data = unwrapResponse(await request(`/api/recipes/${encodeURIComponent(normalizedId)}`, {
            method: 'DELETE',
          }));
          removeRecipeLocally(normalizedId);
          lastSaveTarget = 'remote';
          return data || { id: normalizedId, deleted: true };
        } catch (error) {
          if (error.code === 'NOT_FOUND') {
            removeRecipeLocally(normalizedId);
            return { id: normalizedId, deleted: true };
          }
          if (error.code === 'KV_NOT_CONFIGURED') {
            lastSaveFailure = '服务器未配置 CONTENT_KV，无法在线删除';
          } else if (error.status === 403) {
            lastSaveFailure = '管理员权限失效，请重新登录';
            throw error;
          } else {
            lastSaveFailure = error.message || '服务器删除失败';
            throw error;
          }
        }
      }

      removeRecipeLocally(normalizedId);
      return { id: normalizedId, deleted: true };
    }

    if (type === 'ingredient') {
      if (hasRemote) {
        try {
          const data = unwrapResponse(await request(`/api/ingredients/${encodeURIComponent(normalizedId)}`, {
            method: 'DELETE',
          }));
          removeIngredientLocally(normalizedId);
          lastSaveTarget = 'remote';
          return data || { id: normalizedId, deleted: true };
        } catch (error) {
          if (error.code === 'NOT_FOUND') {
            removeIngredientLocally(normalizedId);
            return { id: normalizedId, deleted: true };
          }
          if (error.code === 'KV_NOT_CONFIGURED') {
            lastSaveFailure = '服务器未配置 CONTENT_KV，无法在线删除';
          } else if (error.status === 403) {
            lastSaveFailure = '管理员权限失效，请重新登录';
            throw error;
          } else {
            lastSaveFailure = error.message || '服务器删除失败';
            throw error;
          }
        }
      }

      removeIngredientLocally(normalizedId);
      return { id: normalizedId, deleted: true };
    }

    throw new Error('不支持的删除类型');
  }

  async function deleteManyContent(type, ids) {
    const uniqueIds = [...new Set((ids || []).map((item) => String(item || '').trim()).filter(Boolean))];
    if (!uniqueIds.length) {
      return { deleted: [], failed: [] };
    }

    const deleted = [];
    const failed = [];

    for (const id of uniqueIds) {
      try {
        await deleteContent(type, id);
        deleted.push(id);
      } catch (error) {
        failed.push({ id, message: error?.message || '删除失败' });
      }
    }

    if (!deleted.length && failed.length) {
      const batchError = new Error(failed[0].message || '批量删除失败');
      batchError.failed = failed;
      throw batchError;
    }

    return { deleted, failed };
  }

  async function startRecipeGeneration(name, preferences = '') {
    return unwrapResponse(await request('/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({
        name: String(name || '').trim(),
        preferences: String(preferences || '').trim(),
      }),
    }));
  }

  function collectExistingRecipeIds() {
    const ids = new Set();
    for (const id of Object.keys(window.recipeDetails || {})) {
      if (id) ids.add(id);
    }
    for (const item of window.recipeCatalog?.recipes || []) {
      if (item?.id) ids.add(item.id);
    }
    try {
      const drafts = readDrafts('recipe');
      for (const id of Object.keys(drafts)) {
        if (id) ids.add(id);
      }
    } catch {
      // ignore draft read errors
    }
    return [...ids];
  }

  async function pollRecipeGeneration(agentId, runId, name, preferences = '') {
    const qs = new URLSearchParams({
      agentId: String(agentId || '').trim(),
      runId: String(runId || '').trim(),
      name: String(name || '').trim(),
      preferences: String(preferences || '').trim(),
      existingIds: collectExistingRecipeIds().join(','),
    });
    return unwrapResponse(await request(`/api/recipes/generate/status?${qs}`));
  }

  async function listRecipes() {
    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/recipes'));
        if (Array.isArray(data)) {
          return data.filter((item) => item?.id && !isRecipeDeleted(item.id));
        }
      } catch {
        // fall back to local data
      }
    }

    const drafts = readDrafts('recipe');
    const merged = { ...getSourceMap('recipe'), ...drafts };
    return Object.values(merged)
      .filter((item) => item?.id && !isRecipeDeleted(item.id))
      .map((item) => pickRecipeSummary(item));
  }

  async function listIngredients() {
    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/ingredients'));
        if (Array.isArray(data)) {
          return data.filter((item) => item?.id && !isIngredientDeleted(item.id));
        }
      } catch {
        // fall back to local data
      }
    }

    const drafts = readDrafts('ingredient');
    const deleted = readDeletedIngredientIds();
    const merged = { ...getSourceMap('ingredient'), ...drafts };
    return Object.values(merged)
      .filter((item) => item?.id && !deleted.has(item.id))
      .map((item) => pickIngredientListItem(item));
  }

  async function backfillRecipeIngredients(recipe) {
    if (!recipe || !window.ingredientSync?.ensureRecipeIngredientCatalog) {
      return null;
    }

    const names = window.ingredientSync.collectRecipeIngredientNames(recipe);
    if (!names.length) return null;

    let authoritativeCatalog = window.recipeCatalog?.ingredients || [];
    if (hasRemote) {
      try {
        const remoteList = await listIngredients();
        if (Array.isArray(remoteList)) {
          authoritativeCatalog = remoteList;
        }
      } catch {
        // keep local catalog fallback
      }
    }

    const missing = names.filter((name) => !window.ingredientSync.resolveIngredientByName(name, {
      catalogIngredients: authoritativeCatalog,
      catalogOnly: true,
    }));
    if (!missing.length) return null;

    const items = window.ingredientSync.ensureRecipeIngredientCatalog({
      ...recipe,
      ingredientCatalog: [],
    });

    try {
      const result = await syncIngredientCatalog(items);
      if (window.recipeCatalog) {
        await syncCatalogIngredients(window.recipeCatalog);
      }
      return result;
    } catch {
      return null;
    }
  }

  async function syncIngredientCatalog(items) {
    if (!Array.isArray(items) || !items.length) {
      return { created: [], updated: [], skipped: [] };
    }

    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/ingredients/sync', {
          method: 'POST',
          body: JSON.stringify({ items }),
        }));
        lastIngredientSync = data || null;
        upsertLocalIngredients(items);
        return data || { created: [], updated: [], skipped: [] };
      } catch (error) {
        if (error.status === 403) {
          throw error;
        }
        // fall through to local upsert
      }
    }

    lastIngredientSync = upsertLocalIngredients(items);
    return lastIngredientSync;
  }

  function mergeCatalogIngredients(catalog, remoteList, options = {}) {
    if (!catalog) return catalog;

    const deleted = readDeletedIngredientIds();

    if (options.remoteAuthoritative && Array.isArray(remoteList)) {
      catalog.ingredients = remoteList
        .filter((item) => item?.id && !deleted.has(item.id))
        .map((item) => mergeIngredientSnapshot(null, item))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
      return catalog;
    }

    if (!Array.isArray(remoteList)) return catalog;

    const byId = new Map();
    for (const item of catalog.ingredients || []) {
      if (item?.id && !deleted.has(item.id)) {
        byId.set(item.id, { ...item });
      }
    }

    const details = getSourceMap('ingredient');
    for (const item of Object.values(details)) {
      if (!item?.id || deleted.has(item.id)) continue;
      const listItem = pickIngredientListItem(item);
      byId.set(item.id, mergeIngredientSnapshot(byId.get(item.id), listItem));
    }

    for (const item of remoteList) {
      if (!item?.id || deleted.has(item.id)) continue;
      byId.set(item.id, mergeIngredientSnapshot(byId.get(item.id), item));
      details[item.id] = mergeIngredientSnapshot(details[item.id], item);
    }

    catalog.ingredients = Array.from(byId.values()).sort((a, b) => (
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    ));
    return catalog;
  }

  function mergeCatalogRecipes(catalog, remoteList, options = {}) {
    if (!catalog || !Array.isArray(remoteList)) return catalog;
    const deleted = readDeletedRecipeIds();

    if (options.remoteAuthoritative) {
      catalog.recipes = remoteList
        .filter((item) => item?.id && !deleted.has(item.id))
        .map((item) => mergeRecipeSnapshot(null, item))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
      return catalog;
    }

    const byId = new Map(
      (catalog.recipes || [])
        .filter((item) => item?.id && !deleted.has(item.id))
        .map((item) => [item.id, item]),
    );
    for (const item of remoteList) {
      if (!item?.id || deleted.has(item.id)) continue;
      byId.set(item.id, mergeRecipeSnapshot(byId.get(item.id), item));
    }
    catalog.recipes = Array.from(byId.values()).sort((a, b) => (
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    ));
    return catalog;
  }

  async function syncCatalogRecipes(catalog) {
    if (!catalog) return catalog;

    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/recipes'));
        if (Array.isArray(data)) {
          const remoteList = data.filter((item) => item?.id && !isRecipeDeleted(item.id));
          return mergeCatalogRecipes(catalog, remoteList, { remoteAuthoritative: true });
        }
      } catch {
        // fall back to local drafts / seed summaries
      }
    }

    const localList = await listRecipes();
    return mergeCatalogRecipes(
      catalog,
      Array.isArray(localList) ? localList : [],
      { remoteAuthoritative: true },
    );
  }

  function isRemoteConfigured() {
    return hasRemote;
  }

  function getEditLink(type, id) {
    return `./edit.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  }

  function getNewRecipeLink() {
    return './edit.html?type=recipe&new=1';
  }

  function getModeLabel() {
    return hasRemote ? '在线接口' : '本地草稿';
  }

  async function getSessionStatus() {
    const token = window.localStorage.getItem('content-admin-token') || '';
    if (!token) {
      return {
        hasToken: false,
        isAdmin: false,
        checkedRemote: false,
      };
    }

    if (!hasRemote) {
      return {
        hasToken: true,
        isAdmin: isAdminMode(),
        checkedRemote: false,
      };
    }

    try {
      const response = await fetch(`${remoteBase}/api/me`, {
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      const payload = await response.json().catch(() => null);
      return {
        hasToken: true,
        isAdmin: Boolean(payload?.ok && payload?.data?.isAdmin),
        checkedRemote: true,
      };
    } catch {
      return {
        hasToken: true,
        isAdmin: isAdminMode(),
        checkedRemote: false,
      };
    }
  }

  function clearAdminSession() {
    window.localStorage.removeItem('content-admin-token');
    window.localStorage.removeItem('content-admin-mode');
  }

  function isAdminMode() {
    const flag = window.__IS_ADMIN__;
    if (typeof flag === 'boolean') return flag;

    const localFlag = window.localStorage.getItem('content-admin-mode');
    if (localFlag === '1') return true;
    if (localFlag === '0') return false;

    return !hasRemote;
  }

  function canEdit() {
    return isAdminMode();
  }

  async function canBatchManage() {
    const session = await getSessionStatus();
    if (!session.hasToken) return false;
    if (hasRemote) {
      if (!session.checkedRemote) return false;
      return Boolean(session.isAdmin);
    }
    return Boolean(session.isAdmin);
  }

  window.contentApi = {
    loadContent,
    saveContent,
    createContent,
    deleteContent,
    deleteManyContent,
    startRecipeGeneration,
    pollRecipeGeneration,
    listRecipes,
    listIngredients,
    syncIngredientCatalog,
    backfillRecipeIngredients,
    mergeCatalogRecipes,
    syncCatalogRecipes,
    mergeCatalogIngredients,
    syncCatalogIngredients,
    applyRecipeIngredientLinks,
    getLastIngredientSync,
    getLastSaveTarget,
    getLastSaveFailure,
    isRemoteConfigured,
    getEditLink,
    getNewRecipeLink,
    getModeLabel,
    getSessionStatus,
    clearAdminSession,
    isAdminMode,
    canEdit,
    canBatchManage,
  };
})();
