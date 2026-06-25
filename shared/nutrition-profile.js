const DAILY_REFERENCE = {
  calories: 2000,
  protein: 60,
  fat: 60,
  carbs: 300,
  fiber: 25,
};

function round1(value) {
  return Number(Number(value || 0).toFixed(1));
}

function parseNutrientNumber(value) {
  const match = String(value ?? '').match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
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

function parseAmountToGrams(amount) {
  const text = String(amount || '').trim();
  if (!text) return 0;

  const gMatch = text.match(/([\d.]+)\s*(?:g|G|克)/);
  if (gMatch) return Number(gMatch[1]);

  const kgMatch = text.match(/([\d.]+)\s*(?:kg|千克|公斤)/i);
  if (kgMatch) return Number(kgMatch[1]) * 1000;

  const mlMatch = text.match(/([\d.]+)\s*(?:ml|mL|毫升)/i);
  if (mlMatch) return Number(mlMatch[1]);

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

function estimateServingWeightG(recipe, calories) {
  let total = 0;
  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      total += parseAmountToGrams(item.amount);
    }
  }

  if (total >= 120) {
    return Math.round(total);
  }

  if (calories >= 480) return 380;
  if (calories >= 400) return 340;
  if (calories >= 300) return 300;
  if (calories >= 200) return 260;
  return 220;
}

function getFoodGrade(per100gCalories) {
  if (per100gCalories <= 120) {
    return {
      level: '绿灯',
      tone: '轻负担',
      note: '每100g热量较低，适合日常和轻食场景。',
    };
  }

  if (per100gCalories <= 200) {
    return {
      level: '黄灯',
      tone: '注意份量',
      note: '热量和脂肪中等，建议搭配蔬菜并控制份量。',
    };
  }

  return {
    level: '红灯',
    tone: '高热量',
    note: '每100g热量偏高，更适合作为正餐并减少其他高热量搭配。',
  };
}

function buildNutritionProfile(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  if (recipe.nutritionProfile && typeof recipe.nutritionProfile === 'object') {
    return recipe.nutritionProfile;
  }

  const nutrients = getNutrientValues(recipe);
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

  return {
    servingWeightG,
    dailyReference: { ...DAILY_REFERENCE },
    per100g,
    energySharePercent: round1((nutrients.calories / DAILY_REFERENCE.calories) * 100),
    nutrientSharePercent,
    foodGrade: getFoodGrade(per100g.calories),
  };
}

function ensureNutritionProfile(recipe) {
  if (!recipe || typeof recipe !== 'object') return recipe;
  if (recipe.nutritionProfile) return recipe;
  const profile = buildNutritionProfile(recipe);
  if (!profile) return recipe;
  return { ...recipe, nutritionProfile: profile };
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildNutritionProfile,
    ensureNutritionProfile,
  };
}

if (typeof window !== 'undefined') {
  window.nutritionProfileBuilder = {
    buildNutritionProfile,
    ensureNutritionProfile,
  };
}
