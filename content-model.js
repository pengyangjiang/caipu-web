(function () {
  const DEFAULT_VERSION = 1;

  function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeRecipe(record) {
    if (!record) return null;
    const normalized = clone(record);
    normalized.version = Number(normalized.version || DEFAULT_VERSION);
    normalized.updatedAt = normalizeText(normalized.updatedAt) || null;
    normalized.summary = Array.isArray(normalized.summary) ? normalized.summary : [];
    normalized.meta = Array.isArray(normalized.meta) ? normalized.meta : [];
    normalized.tags = Array.isArray(normalized.tags) ? normalized.tags : [];
    normalized.statusTags = Array.isArray(normalized.statusTags) ? normalized.statusTags : [];
    normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
    normalized.ingredients = Array.isArray(normalized.ingredients) ? normalized.ingredients : [];
    normalized.steps = Array.isArray(normalized.steps) ? normalized.steps : [];
    normalized.tips = Array.isArray(normalized.tips) ? normalized.tips : [];
    normalized.nutrition = Array.isArray(normalized.nutrition) ? normalized.nutrition : [];
    normalized.ingredientNames = Array.isArray(normalized.ingredientNames)
      ? normalized.ingredientNames
      : normalized.ingredients.flatMap((group) => (group.items || []).map((item) => item.name));
    normalized.ingredientCount = Number(
      normalized.ingredientCount ?? normalized.ingredientNames.length
    );
    normalized.calories = {
      perServing: 0,
      total: 0,
      unit: '千卡',
      note: '',
      ...(normalized.calories || {}),
    };
    if (normalized.nutritionProfile?.source !== 'manual' && window.nutritionProfileBuilder?.ensureNutritionProfile) {
      return window.nutritionProfileBuilder.ensureNutritionProfile(normalized, {
        ingredientDetails: window.ingredientDetails,
        catalogIngredients: window.recipeCatalog?.ingredients,
      });
    }
    return normalized;
  }

  function normalizeIngredient(record) {
    if (!record) return null;
    const normalized = clone(record);
    normalized.version = Number(normalized.version || DEFAULT_VERSION);
    normalized.updatedAt = normalizeText(normalized.updatedAt) || null;
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

  function inferType(record) {
    if (!record) return null;
    if (Array.isArray(record.ingredients) || Array.isArray(record.steps) || Array.isArray(record.summary)) {
      return 'recipe';
    }
    if (Array.isArray(record.aliases) || Object.prototype.hasOwnProperty.call(record, 'caloriesPer100g')) {
      return 'ingredient';
    }
    return null;
  }

  function normalize(type, record) {
    return type === 'ingredient' ? normalizeIngredient(record) : normalizeRecipe(record);
  }

  function createRecipePayload(source, patch = {}) {
    return normalizeRecipe({ ...clone(source), ...clone(patch) });
  }

  function createIngredientPayload(source, patch = {}) {
    return normalizeIngredient({ ...clone(source), ...clone(patch) });
  }

  function createDraftId(type, id) {
    return `${type}:${id}`;
  }

  window.contentModel = {
    defaultVersion: DEFAULT_VERSION,
    now,
    inferType,
    normalize,
    normalizeRecipe,
    normalizeIngredient,
    createRecipePayload,
    createIngredientPayload,
    createDraftId,
  };
})();
