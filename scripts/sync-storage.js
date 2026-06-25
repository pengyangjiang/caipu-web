const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserExport } = require('./load-browser-export');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = path.join(ROOT, 'backend', 'storage');
const RECIPE_DETAILS_FILE = path.join(ROOT, 'recipe-details.js');
const INGREDIENT_DETAILS_FILE = path.join(ROOT, 'ingredient-details.js');
const RECIPES_FILE = path.join(STORAGE_DIR, 'recipes.json');
const INGREDIENTS_FILE = path.join(STORAGE_DIR, 'ingredients.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function countKeys(record) {
  return Object.keys(record || {}).length;
}

function main() {
  ensureDir(STORAGE_DIR);

  const recipes = loadBrowserExport(RECIPE_DETAILS_FILE, 'recipeDetails');
  const ingredients = loadBrowserExport(INGREDIENT_DETAILS_FILE, 'ingredientDetails');

  writeJson(RECIPES_FILE, recipes);
  writeJson(INGREDIENTS_FILE, ingredients);

  console.log(`已同步 ${countKeys(recipes)} 条菜谱 -> backend/storage/recipes.json`);
  console.log(`已同步 ${countKeys(ingredients)} 条食材 -> backend/storage/ingredients.json`);
  console.log('数据源: recipe-details.js, ingredient-details.js');
}

main();
