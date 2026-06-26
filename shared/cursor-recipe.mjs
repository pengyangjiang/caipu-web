const CURSOR_API_BASE = 'https://api.cursor.com';

const CATEGORY_IDS = ['breakfast', 'lunch', 'dinner', 'light', 'quick'];
const RECIPE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidRecipeId(id) {
  return RECIPE_ID_PATTERN.test(String(id || '').trim());
}

export function slugifyRecipeName(name) {
  const ascii = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (ascii && isValidRecipeId(ascii)) {
    return ascii;
  }

  const seed = String(name || 'recipe').trim();
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `recipe-${Math.abs(hash).toString(36)}`;
}

export function resolveUniqueRecipeId(candidateId, formalName, existingIds) {
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  let base = isValidRecipeId(candidateId) ? String(candidateId).trim() : slugifyRecipeName(formalName);
  if (!isValidRecipeId(base)) {
    base = slugifyRecipeName(formalName);
  }

  if (!taken.has(base)) {
    return base;
  }

  for (let index = 2; index < 1000; index += 1) {
    const next = `${base}-${index}`;
    if (!taken.has(next)) {
      return next;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

function buildRecipePrompt(workingName, preferences) {
  const preferenceBlock = preferences
    ? `\n用户做法偏好：${preferences}\n请将这些偏好融入正式菜名、简介、食材用量与步骤中。`
    : '';

  return `你是菜谱数据助手。用户想做的菜：「${workingName}」。${preferenceBlock}

请生成完整结构化数据，并自行确定合适的正式中文菜名与菜谱 ID。

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段要求：
{
  "id": "小写英文连字符 slug，2-5 个英文词，语义清晰，如 tomato-egg-stir-fry-low-oil",
  "name": "正式中文菜名",
  "coverImage": "https://images.unsplash.com/photo-... 格式的封面图 URL",
  "desc": "一句话到两句话简介",
  "categories": ["从 breakfast,lunch,dinner,light,quick 中选 1-3 个"],
  "tags": ["2-4 个中文标签"],
  "statusTags": ["如 30分钟完成", "1人份", "难度：简单"],
  "calories": { "perServing": 数字, "total": 数字, "unit": "千卡", "note": "按 1 人份计算" },
  "summary": [{ "label": "热量", "value": "286 kcal" }, { "label": "蛋白质", "value": "31g" }, { "label": "脂肪", "value": "11g" }, { "label": "碳水", "value": "18g" }],
  "meta": [{ "label": "烹饪时长", "value": "30 分钟" }, { "label": "份量", "value": "1 人份" }, { "label": "难度", "value": "简单" }],
  "ingredients": [{ "group": "主料", "items": [{ "name": "食材", "amount": "用量" }] }],
  "ingredientCatalog": [
    {
      "id": "chicken-breast",
      "name": "鸡胸肉",
      "aliases": ["鸡胸"],
      "category": "蛋白质",
      "unit": "100g",
      "caloriesPer100g": 133,
      "nutritionPer100g": { "protein": 22.3, "fat": 5, "carbs": 0, "fiber": 0 },
      "handlingTips": ["解冻后擦干表面水分再烹饪", "逆纹切片口感更嫩"],
      "storageTips": ["冷藏 1-2 天内食用", "可分装冷冻保存 1 个月"],
      "cookingNotes": ["适合煎、烤、水煮", "不宜久煮以免发柴"]
    }
  ],
  "steps": [{ "title": "步骤标题", "content": "步骤内容", "time": "5 分钟" }],
  "nutrition": [{ "label": "蛋白质", "value": "31", "unit": "g / 份" }],
  "tips": [{ "title": "小贴士标题", "content": "内容" }]
}

注意：数值合理、步骤 3-6 步、食材分组清晰、使用简体中文。
id 只能包含小写英文字母、数字和连字符；name 必须是中文菜名。
ingredientCatalog 必须覆盖 ingredients 中出现的每一种食材（含全部主料与调料），不可遗漏任何一项。
ingredientCatalog 中每种食材的 handlingTips、storageTips、cookingNotes 必须是通用知识，只描述该食材本身；不要提及具体菜名，不要写「用于某道菜」「配合番茄/鸡蛋」等针对单一菜谱的表述。
ingredientCatalog 每种食材：id 使用小写英文连字符，category 从「蛋白质、蔬菜、主食、调味料、乳制品、油脂、香辛料、其他」中选择，并给出合理的每100g营养值；handlingTips 2-3 条、storageTips 1-2 条、cookingNotes 1-2 条，均为中文短句数组。`;
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

function normalizeGeneratedRecipe(recipe, workingName, options = {}) {
  const normalized = recipe && typeof recipe === 'object' ? recipe : {};
  const formalName = String(normalized.name || workingName || '').trim() || workingName;
  const resolvedId = resolveUniqueRecipeId(
    normalized.id,
    formalName,
    options.existingIds || [],
  );

  normalized.id = resolvedId;
  normalized.name = formalName;
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
  normalized.ingredientCatalog = Array.isArray(normalized.ingredientCatalog)
    ? normalized.ingredientCatalog
    : [];
  normalized.version = 1;
  normalized.updatedAt = null;
  return normalized;
}

function parseRecipeFromAgentText(text, workingName, options = {}) {
  const parsed = extractJsonObject(text);
  return normalizeGeneratedRecipe(parsed, workingName, options);
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

function buildAgentCreateBody(workingName, preferences, modelId) {
  const body = {
    prompt: { text: buildRecipePrompt(workingName, preferences) },
  };

  const normalizedModelId = String(modelId || '').trim();
  if (normalizedModelId) {
    body.model = { id: normalizedModelId };
  }

  return body;
}

export async function startRecipeGeneration(apiKey, workingName, options = {}) {
  const name = String(workingName || '').trim();
  if (!name) {
    throw new Error('请提供菜名');
  }

  const preferences = String(options.preferences || '').trim();
  const payload = await cursorRequest(apiKey, '/v1/agents', {
    method: 'POST',
    body: JSON.stringify(buildAgentCreateBody(name, preferences, options.modelId)),
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
    name,
    preferences,
  };
}

export async function pollRecipeGeneration(apiKey, agentId, runId, workingName, options = {}) {
  const run = await cursorRequest(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`);

  const status = run?.status || 'UNKNOWN';
  if (status === 'CREATING' || status === 'RUNNING') {
    return { status, recipe: null };
  }

  if (status === 'FINISHED') {
    const recipe = parseRecipeFromAgentText(run?.result || '', workingName, {
      existingIds: options.existingIds || [],
    });
    return { status, recipe };
  }

  const error = new Error(`AI 生成失败：${status}`);
  error.code = 'GENERATION_FAILED';
  throw error;
}
