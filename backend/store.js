const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserExport } = require('../scripts/load-browser-export');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = path.join(__dirname, 'storage');
const RECIPES_FILE = path.join(STORAGE_DIR, 'recipes.json');
const INGREDIENTS_FILE = path.join(STORAGE_DIR, 'ingredients.json');
const DATA_FILE = path.join(ROOT, 'data.js');
const RECIPE_DETAILS_FILE = path.join(ROOT, 'recipe-details.js');
const INGREDIENT_DETAILS_FILE = path.join(ROOT, 'ingredient-details.js');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRecipe(record) {
  if (!record) return null;
  const normalized = clone(record);
  normalized.version = Number(normalized.version || 1);
  normalized.updatedAt = normalizeText(normalized.updatedAt) || null;
  normalized.createdAt = normalizeText(normalized.createdAt) || normalized.updatedAt || new Date().toISOString();
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
  return normalized;
}

function normalizeIngredient(record) {
  if (!record) return null;
  const normalized = clone(record);
  normalized.version = Number(normalized.version || 1);
  normalized.updatedAt = normalizeText(normalized.updatedAt) || null;
  normalized.createdAt = normalizeText(normalized.createdAt) || normalized.updatedAt || new Date().toISOString();
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
    ingredientNames: recipe.ingredientNames,
    ingredientCount: recipe.ingredientCount,
    version: recipe.version,
    updatedAt: recipe.updatedAt,
    createdAt: recipe.createdAt,
    meta: recipe.meta,
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
    nutritionPer100g: ingredient.nutritionPer100g,
    version: ingredient.version,
    updatedAt: ingredient.updatedAt,
    createdAt: ingredient.createdAt,
  };
}

function getMapValues(map) {
  return Object.values(map);
}

function createStore() {
  ensureDir(STORAGE_DIR);

  const catalog = loadBrowserExport(DATA_FILE, 'recipeCatalog');
  const seedRecipes = loadBrowserExport(RECIPE_DETAILS_FILE, 'recipeDetails') || {};
  const seedIngredients = loadBrowserExport(INGREDIENT_DETAILS_FILE, 'ingredientDetails') || {};

  const initialRecipes = fs.existsSync(RECIPES_FILE) ? readJson(RECIPES_FILE) : seedRecipes;
  const initialIngredients = fs.existsSync(INGREDIENTS_FILE) ? readJson(INGREDIENTS_FILE) : seedIngredients;

  let recipes = Object.fromEntries(
    Object.entries(initialRecipes).map(([id, value]) => [id, normalizeRecipe(value)])
  );
  let ingredients = Object.fromEntries(
    Object.entries(initialIngredients).map(([id, value]) => [id, normalizeIngredient(value)])
  );

  writeJson(RECIPES_FILE, recipes);
  writeJson(INGREDIENTS_FILE, ingredients);

  function persist() {
    writeJson(RECIPES_FILE, recipes);
    writeJson(INGREDIENTS_FILE, ingredients);
  }

  function assertRecord(record, type) {
    if (!record) {
      const error = new Error(`${type} not found`);
      error.code = 'NOT_FOUND';
      throw error;
    }
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

  function assertNewId(id, map, type) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedId)) {
      const error = new Error('Recipe id must use lowercase letters, numbers and hyphens');
      error.code = 'INVALID_ID';
      throw error;
    }
    if (map[normalizedId]) {
      const error = new Error(`${type} id already exists`);
      error.code = 'ALREADY_EXISTS';
      throw error;
    }
    return normalizedId;
  }

  function createRecipeRecord(id, patch) {
    const normalizedId = assertNewId(id, recipes, 'Recipe');
    const next = normalizeRecipe({
      ...clone(patch),
      id: normalizedId,
      version: 1,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    next.ingredientNames = Array.isArray(next.ingredientNames)
      ? next.ingredientNames
      : next.ingredients.flatMap((group) => (group.items || []).map((item) => item.name));
    next.ingredientCount = Number(next.ingredientCount || next.ingredientNames.length);
    recipes[normalizedId] = next;
    persist();
    return next;
  }

  return {
    catalog,
    getSearchIndex() {
      return {
        categories: catalog.categories || [],
        searchHints: catalog.searchHints || [],
        defaultRecipeId: catalog.defaultRecipeId || '',
        recipes: getMapValues(recipes).map(pickRecipeSummary),
        ingredients: getMapValues(ingredients).map(pickIngredientSummary),
      };
    },
    listRecipes() {
      return getMapValues(recipes).map(pickRecipeSummary);
    },
    listIngredients() {
      return getMapValues(ingredients).map(pickIngredientSummary);
    },
    getRecipe(id) {
      return recipes[id] ? normalizeRecipe(recipes[id]) : null;
    },
    getIngredient(id) {
      return ingredients[id] ? normalizeIngredient(ingredients[id]) : null;
    },
    updateRecipe(id, patch) {
      const current = recipes[id];
      assertRecord(current, 'Recipe');
      updateVersion(current, patch);
      const next = mergeRecipe(current, patch);
      recipes[id] = next;
      persist();
      return next;
    },
    updateIngredient(id, patch) {
      const current = ingredients[id];
      assertRecord(current, 'Ingredient');
      updateVersion(current, patch);
      const next = mergeIngredient(current, patch);
      ingredients[id] = next;
      persist();
      return next;
    },
    createRecipe(id, patch) {
      return createRecipeRecord(id, patch);
    },
    deleteRecipe(id) {
      const normalizedId = String(id || '').trim();
      assertRecord(recipes[normalizedId], 'Recipe');
      delete recipes[normalizedId];
      persist();
      return { id: normalizedId, deleted: true };
    },
  };
}

module.exports = {
  createStore,
};
