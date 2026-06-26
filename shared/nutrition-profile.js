const DAILY_REFERENCE = {
  calories: 2000,
  protein: 60,
  fat: 60,
  carbs: 300,
  fiber: 25,
};

const PROFILE_VERSION = 3;

const GRADE_RANK = {
  绿灯: 0,
  黄灯: 1,
  红灯: 2,
};

const COOKING_METHOD_RULES = [
  { method: 'deep_fry', pattern: /炸|油炸|deep\s*fry/i },
  { method: 'pan_fry', pattern: /香煎|煎(?!饼)|pan\s*fry/i },
  { method: 'stir_fry', pattern: /炒|爆炒|stir\s*fry/i },
  { method: 'boil', pattern: /煮|焯|炖|boil/i },
  { method: 'steam', pattern: /蒸|steam/i },
  { method: 'roast', pattern: /烤|烘|roast/i },
];

const YIELD_BY_METHOD = {
  deep_fry: 0.62,
  pan_fry: 0.78,
  stir_fry: 0.88,
  boil: 0.92,
  steam: 0.94,
  roast: 0.72,
  default: 1.0,
};

const INGREDIENT_YIELD_OVERRIDE = {
  土豆: { deep_fry: 0.60 },
  马铃薯: { deep_fry: 0.60 },
  红薯: { deep_fry: 0.65 },
};

/** 炸制：按成品固态吸油比例估算（大锅油仅少量进入成品，取 solid 与 usage 的较大值） */
const DEEP_FRY_OIL_ABSORPTION = {
  solidRate: 0.18,
  usageRate: 0.12,
};

const OIL_CALORIES_PER_G = 9;

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

function detectCookingMethod(recipe) {
  const override = recipe?.cookingProfile?.method;
  if (override && YIELD_BY_METHOD[override] !== undefined) {
    return override;
  }

  const text = [
    ...(recipe.tags || []),
    ...(recipe.statusTags || []),
    ...(recipe.steps || []).map((step) => `${step.title || ''} ${step.content || ''}`),
    ...(recipe.ingredients || []).map((group) => group.group || ''),
  ].join(' ');

  for (const rule of COOKING_METHOD_RULES) {
    if (rule.pattern.test(text)) return rule.method;
  }
  return 'default';
}

function getYieldFactor(method, ingredientName, recipe) {
  const name = String(ingredientName || '').trim();
  for (const [key, factors] of Object.entries(INGREDIENT_YIELD_OVERRIDE)) {
    if (name.includes(key) && factors[method] != null) {
      return factors[method];
    }
  }

  const profileFactor = Number(recipe?.cookingProfile?.yieldFactor);
  if (Number.isFinite(profileFactor) && profileFactor > 0 && profileFactor <= 1) {
    return profileFactor;
  }

  return YIELD_BY_METHOD[method] ?? YIELD_BY_METHOD.default;
}

function isOilIngredient(name) {
  const text = String(name || '').trim();
  if (/酱油|蚝油|料酒|豆瓣|沙司|麻油$/.test(text)) return false;
  return /(?:油|黄油|猪油|酥油|margarine)/i.test(text);
}

function classifyIngredient(item, groupName, cookingMethod) {
  const name = String(item.name || '').trim();
  const group = String(groupName || '').trim();

  if (isExcludedBulkLiquid(name, item.amount)) return 'excluded';

  if (isOilIngredient(name)) {
    if (/炸|deep/i.test(group) || cookingMethod === 'deep_fry') {
      return 'pot_oil';
    }
    if (
      cookingMethod === 'stir_fry'
      || cookingMethod === 'pan_fry'
      || /炒|煎|料|辅|调味|制作|烹/i.test(group)
    ) {
      return 'dish_oil';
    }
    const grams = parseAmountToGrams(item.amount);
    if (grams >= 120) return 'pot_oil';
    return 'dish_oil';
  }

  if (/^(?:盐|糖|胡椒|花椒|味精|鸡精)$/.test(name) || /(?:酱|粉|汁|露|料)$/.test(name)) {
    return 'seasoning';
  }

  return 'solid';
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

function addNutrientsFromLookup(grams, item, lookup, totals) {
  if (grams <= 0) return 0;

  const detail = lookup.get(normalizeIngredientName(item.name));
  if (!detail) return 0;

  const factor = grams / 100;
  totals.calories += Number(detail.caloriesPer100g || 0) * factor;
  totals.protein += Number(detail.nutritionPer100g?.protein || 0) * factor;
  totals.fat += Number(detail.nutritionPer100g?.fat || 0) * factor;
  totals.carbs += Number(detail.nutritionPer100g?.carbs || 0) * factor;
  totals.fiber += Number(detail.nutritionPer100g?.fiber || 0) * factor;
  return grams;
}

function addNutrientsFromOilGrams(grams, lookup, itemName, totals) {
  if (grams <= 0) return;

  const detail = lookup.get(normalizeIngredientName(itemName));
  if (detail) {
    addNutrientsFromLookup(grams, { name: itemName }, lookup, totals);
    return;
  }

  totals.fat += grams;
  totals.calories += grams * OIL_CALORIES_PER_G;
}

function estimateDeepFryOilAbsorptionG(finishedSolidG, potOilUsedG, recipe) {
  const solidRate = Number(recipe?.cookingProfile?.oilSolidRate)
    || DEEP_FRY_OIL_ABSORPTION.solidRate;
  const usageRate = Number(recipe?.cookingProfile?.oilUsageRate)
    || DEEP_FRY_OIL_ABSORPTION.usageRate;

  const bySolid = finishedSolidG * solidRate;
  const byUsage = potOilUsedG * usageRate;
  return round1(Math.max(bySolid, byUsage));
}

function analyzeCookingComposition(recipe, lookup) {
  const method = detectCookingMethod(recipe);
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };

  let rawInputWeightG = 0;
  let rawSolidWeightG = 0;
  let finishedSolidG = 0;
  let seasoningG = 0;
  let potOilUsedG = 0;
  let dishOilG = 0;
  let matchedWeight = 0;

  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      const role = classifyIngredient(item, group.group, method);
      const grams = parseAmountToGrams(item.amount);
      if (grams <= 0 || role === 'excluded') continue;

      rawInputWeightG += grams;

      if (role === 'pot_oil') {
        potOilUsedG += grams;
        continue;
      }

      if (role === 'dish_oil') {
        dishOilG += grams;
        matchedWeight += addNutrientsFromLookup(grams, item, lookup, totals) || 0;
        if (!lookup.get(normalizeIngredientName(item.name))) {
          addNutrientsFromOilGrams(grams, lookup, item.name, totals);
          matchedWeight += grams;
        }
        continue;
      }

      if (role === 'seasoning') {
        seasoningG += grams;
        matchedWeight += addNutrientsFromLookup(grams, item, lookup, totals) || 0;
        continue;
      }

      rawSolidWeightG += grams;
      const yieldFactor = getYieldFactor(method, item.name, recipe);
      const effectiveG = grams * yieldFactor;
      finishedSolidG += effectiveG;
      matchedWeight += addNutrientsFromLookup(effectiveG, item, lookup, totals) || 0;
    }
  }

  let oilAbsorbedG = 0;
  if (method === 'deep_fry' || potOilUsedG > 0) {
    oilAbsorbedG = estimateDeepFryOilAbsorptionG(finishedSolidG, potOilUsedG, recipe);
    totals.fat += oilAbsorbedG;
    totals.calories += oilAbsorbedG * OIL_CALORIES_PER_G;
    matchedWeight += oilAbsorbedG;
  }

  const finishedWeightG = Math.round(finishedSolidG + seasoningG + dishOilG + oilAbsorbedG);

  return {
    method,
    rawInputWeightG: round1(rawInputWeightG),
    rawSolidWeightG: round1(rawSolidWeightG),
    finishedSolidG: round1(finishedSolidG),
    seasoningG: round1(seasoningG),
    potOilUsedG: round1(potOilUsedG),
    dishOilG: round1(dishOilG),
    oilAbsorbedG,
    finishedWeightG,
    matchedWeight: round1(matchedWeight),
    solidWeight: round1(rawSolidWeightG + seasoningG + dishOilG),
    nutrients: {
      calories: round1(totals.calories),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs),
      fiber: round1(totals.fiber),
    },
  };
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

  const composition = analyzeCookingComposition(recipe, lookup);
  const { solidWeight, matchedWeight, nutrients } = composition;

  if (solidWeight < 60 || matchedWeight < solidWeight * 0.35) {
    return null;
  }

  return {
    ...nutrients,
    matchedWeight,
    solidWeight,
    composition,
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

function estimateServingWeightG(recipe, calories, composition) {
  if (composition?.finishedWeightG >= 80) {
    return composition.finishedWeightG;
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

  const lookup = createIngredientLookup(options);
  const stated = getNutrientValues(recipe);
  const estimated = estimateNutrientsFromIngredients(recipe, lookup);
  const nutrients = mergeNutrientValues(stated, estimated);
  const composition = estimated?.composition || analyzeCookingComposition(recipe, lookup);

  if (!nutrients.calories) {
    return null;
  }

  const servingWeightG = estimateServingWeightG(recipe, nutrients.calories, composition);
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
    weightModel: 'cooked_yield_v1',
    cookingMethod: composition.method,
    servingWeightG,
    rawInputWeightG: composition.rawInputWeightG,
    finishedSolidG: composition.finishedSolidG,
    dishOilG: composition.dishOilG,
    potOilUsedG: composition.potOilUsedG,
    oilAbsorbedG: composition.oilAbsorbedG,
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

function getDensityLabel(detail, meta, nutrientKey) {
  if (nutrientKey === 'calories') {
    return `${Number(detail.caloriesPer100g || 0)} kcal/100g`;
  }
  return `${Number(detail.nutritionPer100g?.[meta.field] || 0)}g/100g`;
}

function formatFormulaValue(value, unit) {
  return unit === 'kcal' ? `${Number(value || 0).toFixed(1)} kcal` : `${Number(value || 0).toFixed(1)}g`;
}

function buildItemFormula({
  name,
  rawGrams,
  effectiveG,
  yieldFactor,
  role,
  densityLabel,
  value,
  unit,
  nutrientKey,
  composition,
}) {
  const result = formatFormulaValue(value, unit);

  if (name === '炸制吸油') {
    const base = `max(${composition.finishedSolidG}g×18%, ${composition.potOilUsedG}g×12%) = ${composition.oilAbsorbedG}g`;
    if (nutrientKey === 'calories') {
      return `${base} × 9 kcal/g = ${result}`;
    }
    if (nutrientKey === 'fat') {
      return `${base} = ${result}`;
    }
    return `${base}（该项不计入${metaLabel(nutrientKey)}）`;
  }

  if (role === 'solid' && yieldFactor < 0.999) {
    return `${rawGrams}g × ${yieldFactor}(出品率) × ${densityLabel} = ${result}`;
  }

  if (role === 'dish_oil') {
    if (densityLabel) {
      return `${effectiveG}g（烹调用油全额）× ${densityLabel} = ${result}`;
    }
    if (nutrientKey === 'calories') {
      return `${effectiveG}g（烹调用油全额）× 9 kcal/g = ${result}`;
    }
    if (nutrientKey === 'fat') {
      return `${effectiveG}g（烹调用油全额）= ${result}`;
    }
  }

  if (densityLabel) {
    return `${effectiveG}g × ${densityLabel} = ${result}`;
  }

  return `${effectiveG}g（未匹配食材库，未计入）`;
}

function metaLabel(nutrientKey) {
  return NUTRIENT_BREAKDOWN_META[nutrientKey]?.label || '该营养素';
}

function getMergedNutrientField(nutrientKey) {
  return {
    calories: 'calories',
    protein: 'protein',
    fat: 'fat',
    carbs: 'carbs',
  }[nutrientKey] || nutrientKey;
}

function buildFormulaSummary(recipe, nutrientKey, meta, items, composition, options) {
  const unit = meta.unit;
  const field = getMergedNutrientField(nutrientKey);
  const stated = getNutrientValues(recipe);
  const estimatedResult = estimateNutrientsFromIngredients(recipe, createIngredientLookup(options));
  const estimatedNutrients = estimatedResult || { [field]: 0 };
  const merged = mergeNutrientValues(stated, estimatedNutrients);
  const estimatedValue = round1(items.reduce((sum, item) => sum + Number(item.value || 0), 0));
  const statedValue = round1(stated[field] || 0);
  const finalValue = round1(merged[field] || 0);
  const profile = recipe.nutritionProfile || buildNutritionProfile(recipe, options);

  const lines = [];

  if (items.length) {
    const parts = items.map((item) => formatFormulaValue(item.value, unit));
    lines.push({
      kind: 'sum',
      text: `食材估算合计 = ${parts.join(' + ')} = ${formatFormulaValue(estimatedValue, unit)}`,
    });
  } else {
    lines.push({
      kind: 'note',
      text: '暂无可用食材分项，无法列出加总公式。',
    });
  }

  if (nutrientKey === 'calories' || nutrientKey === 'fat') {
    if (statedValue > estimatedValue && statedValue > 0) {
      lines.push({
        kind: 'step',
        text: `菜谱声明 = ${formatFormulaValue(statedValue, unit)}`,
      });
      lines.push({
        kind: 'result',
        text: `最终每份 = max(食材估算, 菜谱声明) = ${formatFormulaValue(finalValue, unit)}`,
      });
    } else {
      lines.push({
        kind: 'result',
        text: `最终每份 = ${formatFormulaValue(finalValue, unit)}`,
      });
    }
  } else if (estimatedValue > 0) {
    lines.push({
      kind: 'result',
      text: `最终每份 = 食材估算 = ${formatFormulaValue(finalValue, unit)}`,
    });
  } else if (statedValue > 0) {
    lines.push({
      kind: 'result',
      text: `最终每份 = 菜谱声明 = ${formatFormulaValue(statedValue, unit)}`,
    });
  } else {
    lines.push({
      kind: 'result',
      text: `最终每份 = ${formatFormulaValue(finalValue, unit)}`,
    });
  }

  if (profile?.servingWeightG && nutrientKey === 'calories' && profile.per100g?.calories) {
    lines.push({
      kind: 'step',
      text: `每100g = ${formatFormulaValue(finalValue, unit)} ÷ ${profile.servingWeightG}g × 100 = ${profile.per100g.calories} kcal/100g`,
    });
  } else if (profile?.servingWeightG && meta.nested && profile.per100g?.[meta.field] != null) {
    lines.push({
      kind: 'step',
      text: `每100g ${meta.label} = ${formatFormulaValue(finalValue, unit)} ÷ ${profile.servingWeightG}g × 100 = ${profile.per100g[meta.field]}g/100g`,
    });
  }

  if (composition?.method === 'deep_fry' && composition.oilAbsorbedG > 0) {
    lines.push({
      kind: 'note',
      text: `炸制成品固态约 ${composition.finishedSolidG}g，吸油约 ${composition.oilAbsorbedG}g；大锅炸油 ${composition.potOilUsedG}g 不全额计入。`,
    });
  } else if (composition?.dishOilG > 0) {
    lines.push({
      kind: 'note',
      text: `烹调用油 ${composition.dishOilG}g 全额计入成品重量与营养。`,
    });
  }

  return {
    lines,
    estimatedValue,
    statedValue,
    finalValue,
  };
}

function getIngredientNutrientBreakdown(recipe, nutrientKey, options = {}) {
  const meta = NUTRIENT_BREAKDOWN_META[nutrientKey];
  if (!meta || !recipe) return null;

  const lookup = createIngredientLookup(options);
  const composition = analyzeCookingComposition(recipe, lookup);
  const contributions = new Map();

  for (const group of recipe.ingredients || []) {
    for (const item of group.items || []) {
      const role = classifyIngredient(item, group.group, composition.method);
      const rawGrams = parseAmountToGrams(item.amount);
      if (rawGrams <= 0 || role === 'excluded' || role === 'pot_oil') continue;

      let effectiveG = rawGrams;
      let yieldFactor = 1;
      if (role === 'solid') {
        yieldFactor = getYieldFactor(composition.method, item.name, recipe);
        effectiveG = rawGrams * yieldFactor;
      }

      const detail = lookup.get(normalizeIngredientName(item.name));
      let value = 0;
      let densityLabel = '';

      if (detail) {
        densityLabel = getDensityLabel(detail, meta, nutrientKey);
        value = readNutrientValueFromDetail(detail, meta, effectiveG);
      } else if (role === 'dish_oil') {
        if (nutrientKey === 'calories') {
          value = effectiveG * OIL_CALORIES_PER_G;
        } else if (nutrientKey === 'fat') {
          value = effectiveG;
        }
      }

      if (value <= 0) continue;

      const key = normalizeIngredientName(item.name);
      const formula = buildItemFormula({
        name: item.name,
        rawGrams,
        effectiveG: round1(effectiveG),
        yieldFactor,
        role,
        densityLabel,
        value: round1(value),
        unit: meta.unit,
        nutrientKey,
        composition,
      });

      const existing = contributions.get(key);
      if (existing) {
        existing.grams = round1(existing.grams + effectiveG);
        existing.value = round1(existing.value + value);
        existing.formula = `${existing.formula}；${formula}`;
        if (!existing.amounts.includes(item.amount)) {
          existing.amounts.push(item.amount);
        }
      } else {
        contributions.set(key, {
          name: item.name,
          amount: item.amount,
          amounts: [item.amount],
          grams: round1(effectiveG),
          value: round1(value),
          formula,
        });
      }
    }
  }

  if (composition.oilAbsorbedG > 0 && (nutrientKey === 'calories' || nutrientKey === 'fat')) {
    const oilValue = nutrientKey === 'calories'
      ? round1(composition.oilAbsorbedG * OIL_CALORIES_PER_G)
      : round1(composition.oilAbsorbedG);
    contributions.set('__absorbed_oil__', {
      name: '炸制吸油',
      amount: `约 ${composition.oilAbsorbedG}g`,
      amounts: [`约 ${composition.oilAbsorbedG}g`],
      grams: composition.oilAbsorbedG,
      value: oilValue,
      formula: buildItemFormula({
        name: '炸制吸油',
        rawGrams: composition.oilAbsorbedG,
        effectiveG: composition.oilAbsorbedG,
        yieldFactor: 1,
        role: 'pot_oil',
        densityLabel: '',
        value: oilValue,
        unit: meta.unit,
        nutrientKey,
        composition,
      }),
    });
  }

  const items = [...contributions.values()]
    .sort((a, b) => b.value - a.value);

  const total = round1(items.reduce((sum, item) => sum + item.value, 0));
  const formulaSummary = buildFormulaSummary(recipe, nutrientKey, meta, items, composition, options);
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
    total: formulaSummary.finalValue || total,
    breakdownTotal: total,
    items: enrichedItems,
    formulaSummary,
    hasData: enrichedItems.length > 0 && total > 0,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildNutritionProfile,
    ensureNutritionProfile,
    createIngredientLookup,
    getIngredientNutrientBreakdown,
    analyzeCookingComposition,
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
    analyzeCookingComposition,
    NUTRIENT_BREAKDOWN_META,
    PROFILE_VERSION,
  };
}
