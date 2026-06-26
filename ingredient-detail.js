const catalog = window.recipeCatalog;
const ingredientDetails = window.ingredientDetails;
const contentApi = window.contentApi;

if (!catalog || !ingredientDetails || !contentApi) {
  throw new Error("recipeCatalog、ingredientDetails 或 contentApi 未加载，请先在 HTML 中引入 data.js 和 api-client.js");
}

const ingredientHero = document.getElementById("ingredientHero");
const ingredientNutrition = document.getElementById("ingredientNutrition");
const ingredientTips = document.getElementById("ingredientTips");
const ingredientRecipes = document.getElementById("ingredientRecipes");
const ingredientBreadcrumb = document.getElementById("ingredientBreadcrumb");
const detailToolbar = document.getElementById("detailToolbar");
const SHOPPING_LIST_KEY = "recipe-shopping-list";

function renderEmpty(message) {
  return `<div class="empty-state">${message}</div>`;
}

function renderList(items, renderItem) {
  return items.map(renderItem).join("");
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[，,、；;|/]+/g, " ").replace(/\s+/g, " ").trim();
}

function getIngredientById(id) {
  return ingredientDetails[id] || null;
}

function getIngredientIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || Object.keys(ingredientDetails)[0] || "";
}

function getIngredientNotes(ingredient) {
  return [
    ...(ingredient.handlingTips || []).map((text) => ({ label: "处理要点", text })),
    ...(ingredient.storageTips || []).map((text) => ({ label: "保存建议", text })),
    ...(ingredient.cookingNotes || []).map((text) => ({ label: "烹饪建议", text })),
  ];
}

function getDailyReference() {
  return {
    calories: 2000,
    protein: 60,
    fat: 60,
    carbs: 300,
    fiber: 25,
  };
}

function getFoodGrade(caloriesPer100g) {
  if (caloriesPer100g >= 350) return { level: "红灯", tone: "高能量食材", className: "red" };
  if (caloriesPer100g >= 120) return { level: "黄灯", tone: "适量使用", className: "yellow" };
  return { level: "绿灯", tone: "轻负担", className: "green" };
}

function getIngredientNutrientRows(ingredient, reference) {
  const per100g = ingredient.nutritionPer100g || {};
  const caloriesShare = ((ingredient.caloriesPer100g / reference.calories) * 100).toFixed(1);
  const proteinShare = per100g.protein ? ((per100g.protein / reference.protein) * 100).toFixed(1) : "0.0";
  const fatShare = per100g.fat ? ((per100g.fat / reference.fat) * 100).toFixed(1) : "0.0";
  const carbsShare = per100g.carbs ? ((per100g.carbs / reference.carbs) * 100).toFixed(1) : "0.0";
  const fiberShare = per100g.fiber ? ((per100g.fiber / reference.fiber) * 100).toFixed(1) : "0.0";

  return [
    { label: "热量", perServing: `${ingredient.caloriesPer100g}`, per100g: `${ingredient.caloriesPer100g}`, percent: `${caloriesShare}%` },
    { label: "蛋白质", perServing: `${per100g.protein ?? "-"}`, per100g: `${per100g.protein ?? "-"}`, percent: `${proteinShare}%` },
    { label: "脂肪", perServing: `${per100g.fat ?? "-"}`, per100g: `${per100g.fat ?? "-"}`, percent: `${fatShare}%` },
    { label: "碳水", perServing: `${per100g.carbs ?? "-"}`, per100g: `${per100g.carbs ?? "-"}`, percent: `${carbsShare}%` },
    { label: "膳食纤维", perServing: `${per100g.fiber ?? "-"}`, per100g: `${per100g.fiber ?? "-"}`, percent: `${fiberShare}%` },
  ];
}

function recipeUsesIngredient(recipe, ingredient) {
  const names = [ingredient.name, ...(ingredient.aliases || [])].map(normalizeText);
  const recipeIngredients = Array.isArray(recipe.ingredientNames) && recipe.ingredientNames.length
    ? recipe.ingredientNames
    : (recipe.ingredients || []).flatMap((group) => (group.items || []).map((item) => item.name));
  return recipeIngredients.some((name) => {
    const itemText = normalizeText(name);
    return names.some((needle) => itemText.includes(needle) || needle.includes(itemText));
  });
}

function getRelatedRecipes(ingredient) {
  return catalog.recipes.filter((recipe) => recipeUsesIngredient(recipe, ingredient));
}

function getShoppingList() {
  try {
    const list = JSON.parse(localStorage.getItem(SHOPPING_LIST_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveShoppingList(list) {
  localStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(list));
}

function normalizeShoppingName(value) {
  return String(value || "").toLowerCase().trim();
}

function mergeUniqueValues(current, incoming) {
  const values = new Set((current || []).filter(Boolean));
  (incoming || []).forEach((value) => {
    const text = String(value || "").trim();
    if (text) values.add(text);
  });
  return [...values];
}

function addIngredientToShoppingList(ingredient) {
  const now = new Date().toISOString();
  const list = getShoppingList();
  const id = normalizeShoppingName(ingredient.name);
  const index = list.findIndex((item) => item.id === id);
  const source = `食材详情页：${ingredient.name}`;

  if (index < 0) {
    list.unshift({
      id,
      name: ingredient.name,
      amounts: [],
      sources: [source],
      checked: false,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const current = list[index];
    list[index] = {
      ...current,
      name: ingredient.name,
      sources: mergeUniqueValues(current.sources, [source]),
      checked: false,
      updatedAt: now,
    };
  }

  saveShoppingList(list);
}

function renderPageToolbar(ingredient) {
  if (!detailToolbar) return;

  const editLink = contentApi.canEdit() ? contentApi.getEditLink("ingredient", ingredient.id) : "";

  detailToolbar.innerHTML = `
    <div class="page-toolbar-group">
      <a class="toolbar-link" href="./ingredients.html">← 返回食材列表</a>
    </div>
    <div class="page-toolbar-group">
      ${editLink ? `<a class="action-link" href="${editLink}">编辑</a>` : ""}
    </div>
  `;
}

function renderIngredientPage(ingredient) {
  if (!ingredient) {
    ingredientHero.innerHTML = renderEmpty("没有找到对应的食材。");
    ingredientNutrition.innerHTML = "";
    ingredientTips.innerHTML = "";
    ingredientRecipes.innerHTML = "";
    ingredientBreadcrumb.textContent = "食材详情";
    if (detailToolbar) detailToolbar.innerHTML = "";
    return;
  }

  document.title = `${ingredient.name} - 食材详情`;
  ingredientBreadcrumb.textContent = ingredient.name;
  renderPageToolbar(ingredient);
  const reference = getDailyReference();
  const foodGrade = getFoodGrade(ingredient.caloriesPer100g);
  const nutrientRows = getIngredientNutrientRows(ingredient, reference);

  ingredientHero.innerHTML = `
    <div class="ingredient-hero-main">
      <span class="eyebrow">食材详情</span>
      <h1 class="ingredient-title">${ingredient.name}</h1>
      <p class="ingredient-desc">
        这是 ${ingredient.name} 的单独页面，你可以查看它的每 100g 热量、营养结构，以及处理和保存时要注意的要点。
      </p>
      <div class="ingredient-chip-group">
        <span class="chip">${ingredient.category}</span>
        <span class="chip">${ingredient.unit}</span>
        <span class="chip">${foodGrade.level}</span>
      </div>
      <button class="action-link detail-inline-action" type="button" data-shopping-add-ingredient="${ingredient.id}">
        加入购物清单
      </button>
    </div>
    <aside class="ingredient-info-card">
      <p class="ingredient-info-title">每 100g 热量</p>
      <p class="ingredient-calorie">${ingredient.caloriesPer100g}<span class="nutrition-unit"> kcal</span></p>
      <p class="metric-sub">${foodGrade.tone}，约占每日需求 ${((ingredient.caloriesPer100g / reference.calories) * 100).toFixed(1)}%</p>
      <p class="metric-sub">版本 v${ingredient.version || 1}</p>
    </aside>
  `;

  ingredientNutrition.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">营养解读</h2>
        <p class="section-note">按 100g 食材计算，展示热量占比和日需参考</p>
      </div>
    </div>
    <div class="nutrition-analysis-grid">
      <article class="nutrition-analysis-card">
        <p class="nutrition-label">每100g热量</p>
        <p class="analysis-value">${ingredient.caloriesPer100g}<span class="nutrition-unit"> kcal</span></p>
        <p class="metric-sub">按 100g 食材计算</p>
      </article>
      <article class="nutrition-analysis-card">
        <p class="nutrition-label">能量占比</p>
        <p class="analysis-value">${((ingredient.caloriesPer100g / reference.calories) * 100).toFixed(1)}<span class="nutrition-unit">%</span></p>
        <p class="metric-sub">占每日参考热量</p>
      </article>
      <article class="nutrition-analysis-card food-grade ${foodGrade.className}">
        <p class="nutrition-label">食物等级</p>
        <p class="analysis-value">${foodGrade.level}</p>
        <p class="metric-sub">${foodGrade.tone}</p>
      </article>
      <article class="nutrition-analysis-card">
        <p class="nutrition-label">常用单位</p>
        <p class="analysis-value">${ingredient.unit}</p>
        <p class="metric-sub">便于换算和记录</p>
      </article>
    </div>
    <div class="nutrition-table">
      <div class="nutrition-table-head">
        <span>营养素</span>
        <span>每份</span>
        <span>每100g</span>
        <span>日需占比</span>
      </div>
      ${renderList(
        nutrientRows,
        (row) => `
          <div class="nutrition-table-row">
            <span class="nutrition-table-label">${row.label}</span>
            <span>${row.perServing}</span>
            <span>${row.per100g}</span>
            <span>${row.percent}</span>
          </div>
        `
      )}
    </div>
  `;

  const notes = getIngredientNotes(ingredient);
  ingredientTips.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">处理要点</h2>
        <p class="section-note">做菜前先看看这些注意事项</p>
      </div>
    </div>
    ${
      notes.length
        ? `<div class="ingredient-tip-list">${renderList(
            notes,
            (item) => `
              <article class="ingredient-tip">
                <strong>${item.label}</strong>
                <div>${item.text}</div>
              </article>
            `
          )}</div>`
        : renderEmpty("暂无处理要点。若由 AI 创建菜谱，保存时会同步写入；也可在编辑页手动补充。")
    }
  `;

  const relatedRecipes = getRelatedRecipes(ingredient);
  ingredientRecipes.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">可以做的菜</h2>
        <p class="section-note">和这个食材相关的菜谱</p>
      </div>
    </div>
    ${
      relatedRecipes.length
        ? `<div class="ingredient-recipe-grid">${renderList(
            relatedRecipes,
            (recipe) => `
              <a class="ingredient-recipe-card" href="./recipe.html?id=${encodeURIComponent(recipe.id)}">
                <div class="ingredient-recipe-card-cover" style="background-image: linear-gradient(180deg, rgba(31,41,55,0.04), rgba(31,41,55,0.38)), url('${recipe.coverImage}')"></div>
                <div class="ingredient-recipe-card-body">
                  <h3 class="ingredient-recipe-card-title">${recipe.name}</h3>
                  <p class="ingredient-recipe-card-desc">${recipe.desc}</p>
                  <div class="ingredient-recipe-card-meta">
                    <span>${recipe.statusTags[0]}</span>
                    <span>${recipe.summary[0].value}</span>
                  </div>
                </div>
              </a>
            `
          )}</div>`
        : renderEmpty("暂时没有找到能用这个食材做的菜。")
    }
  `;

  const shoppingButton = ingredientHero.querySelector("[data-shopping-add-ingredient]");
  if (shoppingButton) {
    shoppingButton.addEventListener("click", () => {
      addIngredientToShoppingList(ingredient);
      window.uiToast?.show(`已加入购物清单：${ingredient.name}`, {
        type: "success",
        duration: 1000,
      });
    });
  }
}

(async function init() {
  if (contentApi?.listRecipes && catalog) {
    try {
      const remoteRecipes = await contentApi.listRecipes();
      if (Array.isArray(remoteRecipes)) {
        contentApi.mergeCatalogRecipes(catalog, remoteRecipes);
      }
    } catch {
      // fall back to bundled catalog
    }
  }

  if (contentApi?.syncCatalogIngredients && catalog) {
    await contentApi.syncCatalogIngredients(catalog);
  }

  const ingredient = await contentApi.loadContent("ingredient", getIngredientIdFromQuery());
  renderIngredientPage(ingredient);
})();
