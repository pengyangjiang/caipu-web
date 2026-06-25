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

  function getLastSaveTarget() {
    return lastSaveTarget;
  }

  function getLastSaveFailure() {
    return lastSaveFailure;
  }

  async function loadContent(type, id) {
    const draft = readDrafts(type)[id] || null;
    const seedRecord = getSourceMap(type)[id] || null;
    let remoteRecord = null;

    if (hasRemote) {
      try {
        const path = type === 'recipe'
          ? `/api/recipes/${encodeURIComponent(id)}`
          : `/api/ingredients/${encodeURIComponent(id)}`;
        const data = unwrapResponse(await request(path));
        if (data) {
          remoteRecord = model.normalize(type, data);
        }
      } catch {
        // fall back to draft / seed data
      }
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
    const normalized = model.normalize(type, {
      ...payload,
      id: normalizedId,
      version: 1,
      updatedAt: model.now(),
    });

    lastSaveTarget = 'local';
    lastSaveFailure = '';

    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/recipes', {
          method: 'POST',
          body: JSON.stringify({ ...normalized, id: normalizedId }),
        }));
        lastSaveTarget = 'remote';
        return model.normalize(type, data || normalized);
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

    return normalized;
  }

  async function startRecipeGeneration(name, id) {
    return unwrapResponse(await request('/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({
        name: String(name || '').trim(),
        id: String(id || '').trim(),
      }),
    }));
  }

  async function pollRecipeGeneration(agentId, runId, name, id) {
    const qs = new URLSearchParams({
      agentId: String(agentId || '').trim(),
      runId: String(runId || '').trim(),
      name: String(name || '').trim(),
      id: String(id || '').trim(),
    });
    return unwrapResponse(await request(`/api/recipes/generate/status?${qs}`));
  }

  async function listRecipes() {
    if (hasRemote) {
      try {
        const data = unwrapResponse(await request('/api/recipes'));
        if (Array.isArray(data)) {
          return data;
        }
      } catch {
        // fall back to local data
      }
    }

    const drafts = readDrafts('recipe');
    const merged = { ...getSourceMap('recipe'), ...drafts };
    return Object.values(merged).map((item) => pickRecipeSummary(item));
  }

  function mergeCatalogRecipes(catalog, remoteList) {
    if (!catalog || !Array.isArray(remoteList)) return catalog;
    const byId = new Map((catalog.recipes || []).map((item) => [item.id, item]));
    for (const item of remoteList) {
      if (!item?.id) continue;
      byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
    }
    catalog.recipes = Array.from(byId.values());
    return catalog;
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

  window.contentApi = {
    loadContent,
    saveContent,
    createContent,
    startRecipeGeneration,
    pollRecipeGeneration,
    listRecipes,
    mergeCatalogRecipes,
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
  };
})();
