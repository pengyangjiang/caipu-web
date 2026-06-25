(function () {
  const model = window.contentModel;
  const remoteBase = (window.__API_BASE_URL__ || window.API_BASE_URL || 'http://localhost:3000').trim();
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
      const error = new Error(`Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  }

  async function loadContent(type, id) {
    const draft = readDrafts(type)[id];
    const localRecord = draft || getSourceMap(type)[id] || null;

    if (hasRemote) {
      try {
        const path = type === 'recipe'
          ? `/api/recipes/${encodeURIComponent(id)}`
          : `/api/ingredients/${encodeURIComponent(id)}`;
        const data = unwrapResponse(await request(path));
        if (data) {
          return model.normalize(type, data);
        }
      } catch {
        // fall back to local data
      }
    }

    return model.normalize(type, localRecord);
  }

  async function saveContent(type, id, payload) {
    const normalized = model.normalize(type, {
      ...payload,
      id,
      version: Number(payload.version || model.defaultVersion) + 1,
      updatedAt: model.now(),
    });

    if (hasRemote) {
      try {
        const path = type === 'recipe'
          ? `/api/recipes/${encodeURIComponent(id)}`
          : `/api/ingredients/${encodeURIComponent(id)}`;
        const data = unwrapResponse(await request(path, {
          method: 'PATCH',
          body: JSON.stringify(normalized),
        }));
        return model.normalize(type, data || normalized);
      } catch {
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

  function isRemoteConfigured() {
    return hasRemote;
  }

  function getEditLink(type, id) {
    return `./edit.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
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
    isRemoteConfigured,
    getEditLink,
    getModeLabel,
    getSessionStatus,
    clearAdminSession,
    isAdminMode,
    canEdit,
  };
})();
