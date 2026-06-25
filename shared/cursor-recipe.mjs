const CURSOR_API_BASE = 'https://api.cursor.com';

const CATEGORY_IDS = ['breakfast', 'lunch', 'dinner', 'light', 'quick'];

function buildRecipePrompt(name, id) {
  return `你是菜谱数据助手。请为中文菜谱「${name}」生成完整结构化数据，菜谱 ID 为「${id}」。

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段要求：
{
  "name": "菜名",
  "coverImage": "https://images.unsplash.com/photo-... 格式的封面图 URL",
  "desc": "一句话到两句话简介",
  "categories": ["从 breakfast,lunch,dinner,light,quick 中选 1-3 个"],
  "tags": ["2-4 个中文标签"],
  "statusTags": ["如 30分钟完成", "1人份", "难度：简单"],
  "calories": { "perServing": 数字, "total": 数字, "unit": "千卡", "note": "按 1 人份计算" },
  "summary": [{ "label": "热量", "value": "286 kcal" }, { "label": "蛋白质", "value": "31g" }, { "label": "脂肪", "value": "11g" }, { "label": "碳水", "value": "18g" }],
  "meta": [{ "label": "烹饪时长", "value": "30 分钟" }, { "label": "份量", "value": "1 人份" }, { "label": "难度", "value": "简单" }],
  "ingredients": [{ "group": "主料", "items": [{ "name": "食材", "amount": "用量" }] }],
  "steps": [{ "title": "步骤标题", "content": "步骤内容", "time": "5 分钟" }],
  "nutrition": [{ "label": "蛋白质", "value": "31", "unit": "g / 份" }],
  "tips": [{ "title": "小贴士标题", "content": "内容" }]
}

注意：数值合理、步骤 3-6 步、食材分组清晰、使用简体中文。`;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('AI 未返回内容');
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('AI 返回内容不是有效 JSON');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeGeneratedRecipe(recipe, id, name) {
  const normalized = recipe && typeof recipe === 'object' ? recipe : {};
  normalized.id = id;
  normalized.name = String(normalized.name || name || '').trim() || name;
  normalized.categories = Array.isArray(normalized.categories)
    ? normalized.categories.filter((item) => CATEGORY_IDS.includes(item))
    : ['lunch'];
  if (!normalized.categories.length) normalized.categories = ['lunch'];
  normalized.tags = Array.isArray(normalized.tags) ? normalized.tags : [];
  normalized.statusTags = Array.isArray(normalized.statusTags) ? normalized.statusTags : [];
  normalized.summary = Array.isArray(normalized.summary) ? normalized.summary : [];
  normalized.meta = Array.isArray(normalized.meta) ? normalized.meta : [];
  normalized.ingredients = Array.isArray(normalized.ingredients) ? normalized.ingredients : [];
  normalized.steps = Array.isArray(normalized.steps) ? normalized.steps : [];
  normalized.nutrition = Array.isArray(normalized.nutrition) ? normalized.nutrition : [];
  normalized.tips = Array.isArray(normalized.tips) ? normalized.tips : [];
  normalized.calories = {
    perServing: Number(normalized.calories?.perServing || 0),
    total: Number(normalized.calories?.total || normalized.calories?.perServing || 0),
    unit: normalized.calories?.unit || '千卡',
    note: normalized.calories?.note || '按 1 人份计算',
  };
  normalized.ingredientNames = normalized.ingredients.flatMap(
    (group) => (group.items || []).map((item) => item.name),
  );
  normalized.ingredientCount = normalized.ingredientNames.length;
  normalized.version = 1;
  normalized.updatedAt = null;
  return normalized;
}

function parseRecipeFromAgentText(text, id, name) {
  const parsed = extractJsonObject(text);
  return normalizeGeneratedRecipe(parsed, id, name);
}

function getCursorAuthHeader(apiKey) {
  const token = String(apiKey || '').trim();
  if (!token) {
    const error = new Error('CURSOR_API_KEY is not configured');
    error.code = 'CURSOR_NOT_CONFIGURED';
    throw error;
  }
  const encoded = typeof btoa === 'function'
    ? btoa(`${token}:`)
    : Buffer.from(`${token}:`).toString('base64');
  return `Basic ${encoded}`;
}

async function cursorRequest(apiKey, path, options = {}) {
  const response = await fetch(`${CURSOR_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: getCursorAuthHeader(apiKey),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Cursor API failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

export async function startRecipeGeneration(apiKey, name, id) {
  const payload = await cursorRequest(apiKey, '/v1/agents', {
    method: 'POST',
    body: JSON.stringify({
      prompt: { text: buildRecipePrompt(name, id) },
      model: {
        id: 'composer-2',
        params: [{ id: 'fast', value: 'true' }],
      },
    }),
  });

  const agentId = payload?.agent?.id;
  const runId = payload?.run?.id || payload?.agent?.latestRunId;
  if (!agentId || !runId) {
    throw new Error('Cursor API 未返回 agent/run 信息');
  }

  return {
    agentId,
    runId,
    status: payload?.run?.status || 'CREATING',
  };
}

export async function pollRecipeGeneration(apiKey, agentId, runId, name, id) {
  const run = await cursorRequest(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`);

  const status = run?.status || 'UNKNOWN';
  if (status === 'CREATING' || status === 'RUNNING') {
    return { status, recipe: null };
  }

  if (status === 'FINISHED') {
    const recipe = parseRecipeFromAgentText(run?.result || '', id, name);
    return { status, recipe };
  }

  const error = new Error(`AI 生成失败：${status}`);
  error.code = 'GENERATION_FAILED';
  throw error;
}
