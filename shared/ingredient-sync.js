const INGREDIENT_CATEGORIES = ['蛋白质', '蔬菜', '主食', '调味料', '乳制品', '油脂', '香辛料', '其他'];

function normalizeIngredientName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function slugifyIngredientId(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `ingredient-${Date.now().toString(36)}`;
}

function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name || '').trim();
  if (!name) return null;

  const id = slugifyIngredientId(raw.id || name);
  const category = INGREDIENT_CATEGORIES.includes(raw.category)
    ? raw.category
    : (String(raw.category || '').trim() || '其他');

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!aliases.includes(name)) aliases.unshift(name);

  return {
    id,
    name,
    aliases: [...new Set(aliases)],
    category,
    unit: String(raw.unit || '100g').trim() || '100g',
    caloriesPer100g: Number(raw.caloriesPer100g || 0),
    nutritionPer100g: {
      protein: Number(raw.nutritionPer100g?.protein || 0),
      fat: Number(raw.nutritionPer100g?.fat || 0),
      carbs: Number(raw.nutritionPer100g?.carbs || 0),
      fiber: Number(raw.nutritionPer100g?.fiber || 0),
    },
    handlingTips: Array.isArray(raw.handlingTips)
      ? raw.handlingTips.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    storageTips: Array.isArray(raw.storageTips)
      ? raw.storageTips.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    cookingNotes: Array.isArray(raw.cookingNotes)
      ? raw.cookingNotes.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    source: raw.source || 'ai',
  };
}

function findIngredientByName(ingredientsMap, name) {
  const target = normalizeIngredientName(name);
  if (!target) return null;

  for (const item of Object.values(ingredientsMap || {})) {
    if (!item) continue;
    if (normalizeIngredientName(item.name) === target) return item;
    if ((item.aliases || []).some((alias) => normalizeIngredientName(alias) === target)) {
      return item;
    }
  }
  return null;
}

function guessIngredientCategory(name) {
  const text = String(name || '').trim();
  if (!text) return '其他';
  if (/油|黄油|奶油|猪油|橄榄油|葵花籽油/.test(text)) return '油脂';
  if (/盐|糖|酱油|醋|料酒|蚝油|味精|鸡精|淀粉|小苏打|发酵粉|番茄酱|豆瓣/.test(text)) return '调味料';
  if (/胡椒|辣椒|花椒|八角|桂皮|香叶|姜|蒜|葱|香菜|孜然/.test(text)) return '香辛料';
  if (/奶|乳|芝士|奶酪|酸奶/.test(text)) return '乳制品';
  if (/米|面|粉|馒头|面包|燕麦|意面|面条|土豆|红薯|玉米/.test(text)) return '主食';
  if (/鸡|鸭|鱼|虾|蟹|贝|肉|猪|牛|羊|蛋|豆腐|豆干|蛋白/.test(text)) return '蛋白质';
  if (/菜|瓜|果|菇|菌|笋|芹|菠|白|生|黄|茄|豆|芽|花|椰/.test(text)) return '蔬菜';
  return '其他';
}

function collectRecipeIngredientNames(recipe) {
  if (Array.isArray(recipe?.ingredientNames) && recipe.ingredientNames.length) {
    return recipe.ingredientNames.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (!Array.isArray(recipe?.ingredients)) return [];
  return recipe.ingredients.flatMap((group) => (
    (group.items || []).map((item) => String(item.name || '').trim()).filter(Boolean)
  ));
}

function sanitizeIngredientTips(tips, ingredientName, otherIngredientNames = [], recipeName = '') {
  const selfKey = normalizeIngredientName(ingredientName);
  const dishName = String(recipeName || '').trim();
  return (Array.isArray(tips) ? tips : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((tip) => {
      if (dishName && tip.includes(dishName)) return false;
      for (const other of otherIngredientNames) {
        const otherName = String(other || '').trim();
        if (!otherName || normalizeIngredientName(otherName) === selfKey) continue;
        if (tip.includes(otherName)) return false;
      }
      return true;
    });
}

function findCatalogEntryByName(catalog, name) {
  const target = normalizeIngredientName(name);
  if (!target) return null;
  for (const entry of catalog || []) {
    if (!entry) continue;
    if (normalizeIngredientName(entry.name) === target) return entry;
    if ((entry.aliases || []).some((alias) => normalizeIngredientName(alias) === target)) {
      return entry;
    }
  }
  return null;
}

function ensureRecipeIngredientCatalog(recipe) {
  const catalog = (Array.isArray(recipe?.ingredientCatalog) ? recipe.ingredientCatalog : [])
    .map((item) => normalizeCatalogEntry(item))
    .filter(Boolean);
  const recipeNames = collectRecipeIngredientNames(recipe);

  for (const name of recipeNames) {
    if (findCatalogEntryByName(catalog, name)) continue;

    catalog.push(normalizeCatalogEntry({
      id: slugifyIngredientId(name),
      name,
      aliases: [name],
      category: guessIngredientCategory(name),
      unit: '100g',
      caloriesPer100g: 0,
      nutritionPer100g: { protein: 0, fat: 0, carbs: 0, fiber: 0 },
      handlingTips: [],
      storageTips: [],
      cookingNotes: [],
      source: 'ai',
    }));
  }

  return catalog.map((entry) => ({
    ...entry,
    handlingTips: sanitizeIngredientTips(entry.handlingTips, entry.name, recipeNames, recipe?.name),
    storageTips: sanitizeIngredientTips(entry.storageTips, entry.name, recipeNames, recipe?.name),
    cookingNotes: sanitizeIngredientTips(entry.cookingNotes, entry.name, recipeNames, recipe?.name),
  }));
}

function resolveIngredientByName(name, options = {}) {
  const catalogIngredients = options.catalogIngredients || [];
  const ingredientDetails = options.ingredientDetails || {};
  const target = normalizeIngredientName(name);
  if (!target) return null;

  for (const item of catalogIngredients) {
    if (!item) continue;
    if (normalizeIngredientName(item.name) === target) return item;
    if ((item.aliases || []).some((alias) => normalizeIngredientName(alias) === target)) {
      return item;
    }
  }

  if (options.catalogOnly) return null;

  return findIngredientByName(ingredientDetails, name);
}

function linkRecipeNamesToCatalog(ingredientsMap, recipeIngredientNames) {
  if (!ingredientsMap || !Array.isArray(recipeIngredientNames)) return;

  for (const rawName of recipeIngredientNames) {
    const name = String(rawName || '').trim();
    if (!name) continue;

    const existing = findIngredientByName(ingredientsMap, name);
    if (existing) {
      if (!(existing.aliases || []).some((alias) => normalizeIngredientName(alias) === normalizeIngredientName(name))) {
        existing.aliases = [...new Set([...(existing.aliases || []), name, existing.name].filter(Boolean))];
      }
      continue;
    }

    const normalized = normalizeIngredientName(name);
    for (const item of Object.values(ingredientsMap)) {
      if (!item?.name) continue;
      const itemName = normalizeIngredientName(item.name);
      if (itemName.includes(normalized) || normalized.includes(itemName)) {
        item.aliases = [...new Set([...(item.aliases || []), name, item.name].filter(Boolean))];
        break;
      }
    }
  }
}

function mergeTextTipArrays(existing, incoming, keepExistingIfManual) {
  const a = (Array.isArray(existing) ? existing : []).map((item) => String(item || '').trim()).filter(Boolean);
  const b = (Array.isArray(incoming) ? incoming : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (keepExistingIfManual && a.length) return a;
  if (!b.length) return a;
  if (!a.length) return b;
  return [...new Set([...a, ...b])];
}

function hasNutritionData(entry) {
  if (!entry) return false;
  const n = entry.nutritionPer100g || {};
  return Number(entry.caloriesPer100g || 0) > 0
    || Number(n.protein || 0) > 0
    || Number(n.fat || 0) > 0
    || Number(n.carbs || 0) > 0
    || Number(n.fiber || 0) > 0;
}

function mergeCatalogEntry(existing, incoming) {
  const aliases = [...new Set([
    ...(existing.aliases || []),
    ...(incoming.aliases || []),
    existing.name,
    incoming.name,
  ].filter(Boolean))];

  const existingHasNutrition = hasNutritionData(existing);
  const incomingHasNutrition = hasNutritionData(incoming);
  const keepExistingTips = existing.source === 'manual';
  const replaceAiTips = incoming.source === 'ai';

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    name: existing.name || incoming.name,
    aliases,
    category: existing.category && existing.category !== '其他' ? existing.category : incoming.category,
    unit: existing.unit || incoming.unit || '100g',
    caloriesPer100g: existingHasNutrition && !incomingHasNutrition
      ? Number(existing.caloriesPer100g || 0)
      : Math.max(Number(existing.caloriesPer100g || 0), Number(incoming.caloriesPer100g || 0)),
    nutritionPer100g: {
      protein: existingHasNutrition && !incomingHasNutrition
        ? Number(existing.nutritionPer100g?.protein || 0)
        : Math.max(Number(existing.nutritionPer100g?.protein || 0), Number(incoming.nutritionPer100g?.protein || 0)),
      fat: existingHasNutrition && !incomingHasNutrition
        ? Number(existing.nutritionPer100g?.fat || 0)
        : Math.max(Number(existing.nutritionPer100g?.fat || 0), Number(incoming.nutritionPer100g?.fat || 0)),
      carbs: existingHasNutrition && !incomingHasNutrition
        ? Number(existing.nutritionPer100g?.carbs || 0)
        : Math.max(Number(existing.nutritionPer100g?.carbs || 0), Number(incoming.nutritionPer100g?.carbs || 0)),
      fiber: existingHasNutrition && !incomingHasNutrition
        ? Number(existing.nutritionPer100g?.fiber || 0)
        : Math.max(Number(existing.nutritionPer100g?.fiber || 0), Number(incoming.nutritionPer100g?.fiber || 0)),
    },
    handlingTips: replaceAiTips
      ? [...(incoming.handlingTips || [])]
      : mergeTextTipArrays(existing.handlingTips, incoming.handlingTips, keepExistingTips),
    storageTips: replaceAiTips
      ? [...(incoming.storageTips || [])]
      : mergeTextTipArrays(existing.storageTips, incoming.storageTips, keepExistingTips),
    cookingNotes: replaceAiTips
      ? [...(incoming.cookingNotes || [])]
      : mergeTextTipArrays(existing.cookingNotes, incoming.cookingNotes, keepExistingTips),
    source: existing.source === 'manual' ? 'manual' : (incoming.source || existing.source || 'ai'),
    version: Number(existing.version || 1),
    createdAt: existing.createdAt,
  };
}

function upsertIngredientCatalog(ingredientsMap, catalogItems, normalizeIngredient) {
  const results = { created: [], updated: [], skipped: [] };

  for (const raw of catalogItems || []) {
    const entry = normalizeCatalogEntry(raw);
    if (!entry) {
      results.skipped.push(raw?.name || 'unknown');
      continue;
    }

    const existingById = ingredientsMap[entry.id];
    const existingByName = findIngredientByName(ingredientsMap, entry.name);
    const existing = existingById || existingByName;

    if (existing) {
      const merged = mergeCatalogEntry(existing, entry);
      const next = normalizeIngredient({
        ...merged,
        version: Number(existing.version || 1) + (merged.source === 'ai' ? 0 : 1),
        updatedAt: new Date().toISOString(),
      });
      ingredientsMap[next.id] = next;
      results.updated.push(next.id);
      continue;
    }

    let finalId = entry.id;
    if (ingredientsMap[finalId] && normalizeIngredientName(ingredientsMap[finalId].name) !== normalizeIngredientName(entry.name)) {
      finalId = `${entry.id}-${Date.now().toString(36).slice(-4)}`;
    }

    ingredientsMap[finalId] = normalizeIngredient({
      ...entry,
      id: finalId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    results.created.push(finalId);
  }

  return results;
}

function stripIngredientCatalog(payload) {
  if (!payload || typeof payload !== 'object') {
    return { recipePayload: payload, ingredientCatalog: [] };
  }
  const { ingredientCatalog, ...recipePayload } = payload;
  return {
    recipePayload,
    ingredientCatalog: Array.isArray(ingredientCatalog) ? ingredientCatalog : [],
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    INGREDIENT_CATEGORIES,
    normalizeIngredientName,
    normalizeCatalogEntry,
    findIngredientByName,
    resolveIngredientByName,
    linkRecipeNamesToCatalog,
    upsertIngredientCatalog,
    stripIngredientCatalog,
    ensureRecipeIngredientCatalog,
    sanitizeIngredientTips,
    collectRecipeIngredientNames,
  };
}

if (typeof window !== 'undefined') {
  window.ingredientSync = {
    INGREDIENT_CATEGORIES,
    normalizeIngredientName,
    normalizeCatalogEntry,
    findIngredientByName,
    resolveIngredientByName,
    linkRecipeNamesToCatalog,
    upsertIngredientCatalog,
    stripIngredientCatalog,
    ensureRecipeIngredientCatalog,
    sanitizeIngredientTips,
    collectRecipeIngredientNames,
  };
}
