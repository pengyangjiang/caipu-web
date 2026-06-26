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
    handlingTips: mergeTextTipArrays(existing.handlingTips, incoming.handlingTips, keepExistingTips),
    storageTips: mergeTextTipArrays(existing.storageTips, incoming.storageTips, keepExistingTips),
    cookingNotes: mergeTextTipArrays(existing.cookingNotes, incoming.cookingNotes, keepExistingTips),
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
  };
}
