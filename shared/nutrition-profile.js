const DAILY_REFERENCE = {
  calories: 2000,
  protein: 60,
  fat: 60,
  carbs: 300,
  fiber: 25,
};

const PROFILE_VERSION = 2;

const GRADE_RANK = {
  绿灯: 0,
  黄灯: 1,
  红灯: 2,
};

function round1(value) {
  return Number(Number(value || 0).toFixed(1));
}

function normalizeIngredientName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function parseNutrientNumber(value) {
  const match = String(value ?? '').match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

function maxGrade(current, next) {
  return GRADE_RANK[next] > GRADE_RANK[current] ? next : current;
}

function createIngredientLookup(options = {}) {
  const lookup = new Map();
  const add = (name, detail) => {
    if (!name || !detail) return;
    lookup.set(normalizeIngredientName(name), detail);
  };

  const details = options.ingredientDetails || (
    typeof window !== 'undefined' ? window.ingredientDetails : null
  );
  if (details && typeof details === 'object') {
    for (const detail of Object.values(details)) {
      add(detail.name, detail);
      (detail.aliases || []).forEach((alias) => add(alias, detail));
    }
  }

  const catalog = options.catalogIngredients || (
    typeof window !== 'undefined' ? window.recipeCatalog?.ingredients : null
  );
  if (Array.isArray(catalog)) {
    for (const item of catalog) {
      const detail = details?.[item.id] || item;
      add(item.name, detail);
      (item.aliases || []).forEach((alias) => add(alias, detail));
    }
  }

  return lookup;
}

function isExcludedBulkLiquid(name, amount) {
  const nameText = String(name || '').trim();
  const amountText = String(amount || '').trim();
  const grams = parseAmountToGrams(amount, { allowLiquids: true });

  if (/^(水|清水|热水|冷水|温水|开水|饮用水)$/.test(nameText)) return true;
  if (/(高汤| stock|broth|汤底)/i.test(nameText) && grams >= 80) return true;
  if (/^(水|汤)/.test(nameText) && grams >= 150) return true;
  if (/水/.test(nameText) && /(?:ml|mL|毫升|升|L)/.test(amountText) && grams >= 80) return true;

  return false;
}

function parseAmountToGrams(amount, options = {}) {
  const text = String(amount || '').trim();
  if (!text) return 0;

  const gMatch = text.match(/([\d.]+)\s*(?:g|G|克)/);
  if (gMatch) return Number(gMatch[1]);

  const kgMatch = text.match(/([\d.]+)\s*(?:kg|千克|公斤)/i);
  if (kgMatch) return Number(kgMatch[1]) * 1000;

  const mlMatch = text.match(/([\d.]+)\s*(?:ml|mL|毫升)/i);
  if (mlMatch) {
    return options.allowLiquids ? Number(mlMatch[1]) : Number(mlMatch[1]);
  }

  const liangMatch = text.match(/([\d.]+)\s*两/);
  if (liangMatch) return Number(liangMatch[1]) * 50;

  if (text.includes('半')) {
    const halfMatch = text.match(/约?\s*([\d.]+)\s*(?:g|克)/);
    if (halfMatch) return Number(halfMatch[1]) / 2;
    return 50;
  }

  const pieceMatch = text.match(/^([\d.]+)\s*个/);
  if (pieceMatch) {
    const inlineG = text.match(/约?\s*([\d.]+)\s*(?:g|克)/);
    if (inlineG) return Number(pieceMatch[1]) * Number(inlineG[1]);
    return Number(pieceMatch[1]) * 100;
  }

  const spoonMatch = text.match(/^([\d.]+)\s*(?:勺|汤匙|茶匙|tbsp|tsp)/i);
  if (spoonMatch) return Number(spoonMatch[1]) * 15;

  if (/^(?:少许|适量|少量)$/.test(text)) return 5;

  return 0;
}

function getNutrientValues(recipe) {
  const summaryMap = new Map((recipe.summary || []).map((item) => [item.label, item.value]));
  const nutritionMap = {};
  for (const item of recipe.nutrition || []) {
    nutritionMap[item.label] = parseNutrientNumber(item.value);
  }

  const calories = Number(recipe.calories?.perServing || 0)
    || parseNutrientNumber(summaryMap.get('热量'));

  return {
    calories,
    protein: nutritionMap['蛋白质'] || parseNutrientNumber(summaryMap.get('蛋白质')),
    fat: nutritionMap['脂肪'] || parseNutrientNumber(summaryMap.get('脂肪')),
    carbs: nutritionMap['碳水'] || parseNutrientNumber(summaryMap.get('碳水')),
    fiber: nutritionMap['膳食纤维'] || parseNutrientNumber(summaryMap.get('膳食纤维')),
  };
}

function estimateNutrientsFromIngredients(recipe, lookup) {
  if (!lookup || lookup.size === 0) return null;

  let matchedWeight = 0;
  let solidWeight = 0;
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let fiber = 0;

  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      if (isExcludedBulkLiquid(item.name, item.amount)) continue;

      const grams = parseAmountToGrams(item.amount);
      if (grams <= 0) continue;
      solidWeight += grams;

      const detail = lookup.get(normalizeIngredientName(item.name));
      if (!detail) continue;

      matchedWeight += grams;
      const factor = grams / 100;
      calories += Number(detail.caloriesPer100g || 0) * factor;
      protein += Number(detail.nutritionPer100g?.protein || 0) * factor;
      fat += Number(detail.nutritionPer100g?.fat || 0) * factor;
      carbs += Number(detail.nutritionPer100g?.carbs || 0) * factor;
      fiber += Number(detail.nutritionPer100g?.fiber || 0) * factor;
    }
  }

  if (solidWeight < 60 || matchedWeight < solidWeight * 0.35) {
    return null;
  }

  return {
    calories: round1(calories),
    protein: round1(protein),
    fat: round1(fat),
    carbs: round1(carbs),
    fiber: round1(fiber),
    matchedWeight: round1(matchedWeight),
    solidWeight: round1(solidWeight),
  };
}

function mergeNutrientValues(stated, estimated) {
  if (!estimated) return stated;

  return {
    calories: Math.max(stated.calories || 0, estimated.calories || 0),
    protein: estimated.protein || stated.protein || 0,
    fat: Math.max(stated.fat || 0, estimated.fat || 0),
    carbs: estimated.carbs || stated.carbs || 0,
    fiber: estimated.fiber || stated.fiber || 0,
  };
}

function estimateServingWeightG(recipe, calories) {
  let solidTotal = 0;

  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      if (isExcludedBulkLiquid(item.name, item.amount)) continue;
      solidTotal += parseAmountToGrams(item.amount);
    }
  }

  if (solidTotal >= 80) {
    return Math.round(solidTotal);
  }

  if (calories >= 480) return 380;
  if (calories >= 400) return 340;
  if (calories >= 300) return 300;
  if (calories >= 200) return 260;
  return 220;
}

function getFoodGrade(per100gCalories, context = {}) {
  const {
    perServingCalories = 0,
    fatSharePercent = 0,
    energySharePercent = 0,
  } = context;

  let grade = '绿灯';
  if (per100gCalories > 200) grade = '红灯';
  else if (per100gCalories > 120) grade = '黄灯';

  if (perServingCalories >= 650 || fatSharePercent >= 85 || energySharePercent >= 40) {
    grade = maxGrade(grade, '红灯');
  } else if (perServingCalories >= 450 || fatSharePercent >= 55 || energySharePercent >= 30) {
    grade = maxGrade(grade, '黄灯');
  }

  if (grade === '红灯') {
    if (fatSharePercent >= 70) {
      return {
        level: '红灯',
        tone: '高脂正餐',
        note: '每份脂肪和总热量偏高，建议小份食用并搭配蔬菜。',
      };
    }
    return {
      level: '红灯',
      tone: '高热量',
      note: '每100g或每份热量偏高，更适合作为正餐并控制其他高热量搭配。',
    };
  }

  if (grade === '黄灯') {
    if (fatSharePercent >= 50) {
      return {
        level: '黄灯',
        tone: '注意份量',
        note: '脂肪占比不低，建议搭配蔬菜并控制食用份量。',
      };
    }
    return {
      level: '黄灯',
      tone: '注意份量',
      note: '热量中等，适合作为正餐并注意当日总摄入。',
    };
  }

  return {
    level: '绿灯',
    tone: '轻负担',
    note: '每100g热量较低，适合日常和轻食场景。',
  };
}

function upsertSummaryRow(summary, label, value) {
  const rows = Array.isArray(summary) ? [...summary] : [];
  const index = rows.findIndex((item) => item.label === label);
  if (index >= 0) {
    rows[index] = { ...rows[index], value };
    return rows;
  }
  return [...rows, { label, value }];
}

function applyComputedNutrients(recipe, nutrients, estimated) {
  if (!nutrients?.calories || !estimated) return recipe;

  const next = { ...recipe };
  next.calories = {
    ...(next.calories || {}),
    perServing: nutrients.calories,
    total: nutrients.calories,
  };
  next.summary = upsertSummaryRow(next.summary, '热量', `${nutrients.calories} kcal`);
  next.summary = upsertSummaryRow(next.summary, '蛋白质', `${nutrients.protein}g`);
  next.summary = upsertSummaryRow(next.summary, '脂肪', `${nutrients.fat}g`);
  next.summary = upsertSummaryRow(next.summary, '碳水', `${nutrients.carbs}g`);
  if (nutrients.fiber) {
    next.summary = upsertSummaryRow(next.summary, '膳食纤维', `${nutrients.fiber}g`);
  }
  return next;
}

function buildNutritionProfile(recipe, options = {}) {
  if (!recipe || typeof recipe !== 'object') return null;

  const existing = recipe.nutritionProfile;
  if (existing?.source === 'manual') {
    return existing;
  }

  const lookup = createIngredientLookup(options);
  const stated = getNutrientValues(recipe);
  const estimated = estimateNutrientsFromIngredients(recipe, lookup);
  const nutrients = mergeNutrientValues(stated, estimated);

  if (!nutrients.calories) {
    return null;
  }

  const servingWeightG = estimateServingWeightG(recipe, nutrients.calories);
  const factor = 100 / servingWeightG;

  const per100g = {
    calories: round1(nutrients.calories * factor),
    protein: round1(nutrients.protein * factor),
    fat: round1(nutrients.fat * factor),
    carbs: round1(nutrients.carbs * factor),
    fiber: round1(nutrients.fiber * factor),
  };

  const nutrientSharePercent = {
    protein: round1((nutrients.protein / DAILY_REFERENCE.protein) * 100),
    fat: round1((nutrients.fat / DAILY_REFERENCE.fat) * 100),
    carbs: round1((nutrients.carbs / DAILY_REFERENCE.carbs) * 100),
    fiber: round1((nutrients.fiber / DAILY_REFERENCE.fiber) * 100),
  };

  const energySharePercent = round1((nutrients.calories / DAILY_REFERENCE.calories) * 100);

  return {
    source: 'computed',
    version: PROFILE_VERSION,
    servingWeightG,
    excludesCookingLiquid: true,
    ingredientMatchWeightG: estimated?.matchedWeight || 0,
    dailyReference: { ...DAILY_REFERENCE },
    per100g,
    energySharePercent,
    nutrientSharePercent,
    foodGrade: getFoodGrade(per100g.calories, {
      perServingCalories: nutrients.calories,
      fatSharePercent: nutrientSharePercent.fat,
      energySharePercent,
    }),
  };
}

function ensureNutritionProfile(recipe, options = {}) {
  if (!recipe || typeof recipe !== 'object') return recipe;
  if (recipe.nutritionProfile?.source === 'manual') return recipe;

  const lookup = createIngredientLookup(options);
  const stated = getNutrientValues(recipe);
  const estimated = estimateNutrientsFromIngredients(recipe, lookup);
  const nutrients = mergeNutrientValues(stated, estimated);
  const enrichedRecipe = applyComputedNutrients(recipe, nutrients, estimated);
  const profile = buildNutritionProfile(enrichedRecipe, options);
  if (!profile) return recipe;
  return { ...enrichedRecipe, nutritionProfile: profile };
}

const NUTRIENT_BREAKDOWN_META = {
  calories: { label: '热量', unit: 'kcal', color: '#d97706', nested: false, field: 'caloriesPer100g' },
  protein: { label: '蛋白质', unit: 'g', color: '#2563eb', nested: true, field: 'protein' },
  fat: { label: '脂肪', unit: 'g', color: '#059669', nested: true, field: 'fat' },
  carbs: { label: '碳水', unit: 'g', color: '#7c3aed', nested: true, field: 'carbs' },
};

const PIE_SLICE_COLORS = [
  '#d97706', '#2563eb', '#059669', '#7c3aed', '#db2777', '#0891b2',
  '#ca8a04', '#4f46e5', '#0d9488', '#9333ea', '#e11d48', '#0284c7',
];

function readNutrientValueFromDetail(detail, meta, grams) {
  const factor = grams / 100;
  if (meta.nested) {
    return Number(detail.nutritionPer100g?.[meta.field] || 0) * factor;
  }
  return Number(detail.caloriesPer100g || 0) * factor;
}

function getIngredientNutrientBreakdown(recipe, nutrientKey, options = {}) {
  const meta = NUTRIENT_BREAKDOWN_META[nutrientKey];
  if (!meta || !recipe) return null;

  const lookup = createIngredientLookup(options);
  const contributions = new Map();

  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      if (isExcludedBulkLiquid(item.name, item.amount)) continue;

      const grams = parseAmountToGrams(item.amount);
      if (grams <= 0) continue;

      const detail = lookup.get(normalizeIngredientName(item.name));
      if (!detail) continue;

      const value = readNutrientValueFromDetail(detail, meta, grams);
      if (value <= 0) continue;

      const key = normalizeIngredientName(item.name);
      const existing = contributions.get(key);
      if (existing) {
        existing.grams = round1(existing.grams + grams);
        existing.value = round1(existing.value + value);
        if (!existing.amounts.includes(item.amount)) {
          existing.amounts.push(item.amount);
        }
      } else {
        contributions.set(key, {
          name: item.name,
          amount: item.amount,
          amounts: [item.amount],
          grams: round1(grams),
          value: round1(value),
        });
      }
    }
  }

  const items = [...contributions.values()]
    .sort((a, b) => b.value - a.value);

  const total = round1(items.reduce((sum, item) => sum + item.value, 0));
  const enrichedItems = items.map((item, index) => ({
    ...item,
    amount: item.amounts.length > 1 ? item.amounts.join(' + ') : item.amount,
    percent: total > 0 ? round1((item.value / total) * 100) : 0,
    color: PIE_SLICE_COLORS[index % PIE_SLICE_COLORS.length],
  }));

  return {
    nutrientKey,
    label: meta.label,
    unit: meta.unit,
    color: meta.color,
    total,
    items: enrichedItems,
    hasData: enrichedItems.length > 0 && total > 0,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildNutritionProfile,
    ensureNutritionProfile,
    createIngredientLookup,
    getIngredientNutrientBreakdown,
    NUTRIENT_BREAKDOWN_META,
    PROFILE_VERSION,
  };
}

if (typeof window !== 'undefined') {
  window.nutritionProfileBuilder = {
    buildNutritionProfile,
    ensureNutritionProfile,
    createIngredientLookup,
    getIngredientNutrientBreakdown,
    NUTRIENT_BREAKDOWN_META,
    PROFILE_VERSION,
  };
}
