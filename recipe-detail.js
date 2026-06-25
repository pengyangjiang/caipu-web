const catalog = window.recipeCatalog;
const contentApi = window.contentApi;

if (!catalog || !contentApi) {
  throw new Error("recipeCatalog 或 contentApi 未加载，请先在 HTML 中引入 data.js 和 api-client.js");
}

const detailRoot = document.getElementById("detailRoot");
const recipeBreadcrumb = document.getElementById("recipeBreadcrumb");
const detailToolbar = document.getElementById("detailToolbar");
const deleteRecipeModal = document.getElementById("deleteRecipeModal");
const deleteRecipeName = document.getElementById("deleteRecipeName");
const deleteRecipeHint = document.getElementById("deleteRecipeHint");
const confirmDeleteRecipeBtn = document.getElementById("confirmDeleteRecipeBtn");
const nutrientBreakdownModal = document.getElementById("nutrientBreakdownModal");
const nutrientBreakdownTitle = document.getElementById("nutrientBreakdownTitle");
const nutrientBreakdownSubtitle = document.getElementById("nutrientBreakdownSubtitle");
const nutrientBreakdownBody = document.getElementById("nutrientBreakdownBody");

const NUTRIENT_LABEL_TO_KEY = {
  热量: "calories",
  蛋白质: "protein",
  脂肪: "fat",
  碳水: "carbs",
};

const FAVORITE_KEY = "recipe-favorites";
const COOK_COUNT_KEY = "recipe-cook-counts";
const SHOPPING_LIST_KEY = "recipe-shopping-list";
let currentRenderedRecipe = null;
let pendingDeleteRecipe = null;

function getRecipeWithNutritionProfile(recipe) {
  if (!recipe) return recipe;
  if (window.nutritionProfileBuilder?.ensureNutritionProfile) {
    return window.nutritionProfileBuilder.ensureNutritionProfile(recipe, {
      ingredientDetails: window.ingredientDetails,
      catalogIngredients: window.recipeCatalog?.ingredients,
    });
  }
  return recipe;
}

function renderEmpty(message) {
  return `<div class="empty-state">${message}</div>`;
}

function renderList(items, renderItem) {
  return items.map(renderItem).join("");
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function getIngredientByName(name) {
  if (window.ingredientSync?.resolveIngredientByName) {
    return window.ingredientSync.resolveIngredientByName(name, {
      catalogIngredients: catalog.ingredients,
      ingredientDetails: window.ingredientDetails,
    });
  }

  const normalized = normalizeText(name);
  return (
    catalog.ingredients.find((ingredient) => {
      if (normalizeText(ingredient.name) === normalized) return true;
      return (ingredient.aliases || []).some((alias) => normalizeText(alias) === normalized);
    }) || null
  );
}

function getIngredientLink(name) {
  const ingredient = getIngredientByName(name);
  return ingredient ? `./ingredient.html?id=${encodeURIComponent(ingredient.id)}` : null;
}

function getRecipeIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || catalog.defaultRecipeId;
}

function getRecipeIndex(id) {
  return catalog.recipes.findIndex((recipe) => recipe.id === id);
}

function getAdjacentRecipeIds(id) {
  const index = getRecipeIndex(id);
  if (index < 0 || catalog.recipes.length === 0) {
    return { prevId: null, nextId: null };
  }

  const prevId = catalog.recipes[(index - 1 + catalog.recipes.length) % catalog.recipes.length].id;
  const nextId = catalog.recipes[(index + 1) % catalog.recipes.length].id;
  return { prevId, nextId };
}

function getRelatedRecipes(recipe, limit = 3) {
  const sourceTags = new Set(recipe.tags || []);
  const sourceCategories = new Set(recipe.categories || []);
  const sourceIngredients = new Set(
    (recipe.ingredients || []).flatMap((group) => group.items.map((item) => item.name))
  );

  return catalog.recipes
    .filter((item) => item.id !== recipe.id)
    .map((item) => {
      const tagScore = item.tags.reduce((score, tag) => score + (sourceTags.has(tag) ? 2 : 0), 0);
      const categoryScore = item.categories.reduce(
        (score, category) => score + (sourceCategories.has(category) ? 3 : 0),
        0
      );
      const itemIngredients = new Set(item.ingredientNames || []);
      let ingredientScore = 0;
      sourceIngredients.forEach((name) => {
        if (itemIngredients.has(name)) ingredientScore += 2;
      });

      return {
        recipe: item,
        score: tagScore + categoryScore + ingredientScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.recipe);
}

function formatDateTime(value) {
  if (!value) return "未记录";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getSummaryRingItems(recipe) {
  const profile = recipe.nutritionProfile || {};
  const summaryMap = new Map((recipe.summary || []).map((item) => [item.label, item.value]));
  const parseNumber = (value) => {
    const match = String(value || "").match(/[\d.]+/);
    return match ? Number(match[0]) : null;
  };

  const fallbackPercent = (value, reference) => {
    if (value == null || !reference) return 0;
    return Number(((value / reference) * 100).toFixed(1));
  };

  const calorieValue = Number(recipe.calories?.perServing || 0);
  const proteinValue = parseNumber(summaryMap.get("蛋白质"));
  const fatValue = parseNumber(summaryMap.get("脂肪"));
  const carbsValue = parseNumber(summaryMap.get("碳水"));

  const items = [
    {
      label: "热量",
      value: summaryMap.get("热量") || `${recipe.calories?.perServing || 0} ${recipe.calories?.unit || "kcal"}`,
      percent: profile.energySharePercent ?? fallbackPercent(calorieValue, 2000),
      color: "#d97706",
    },
    {
      label: "蛋白质",
      value: summaryMap.get("蛋白质") || "-",
      percent: profile.nutrientSharePercent?.protein ?? fallbackPercent(proteinValue, 60),
      color: "#2563eb",
    },
    {
      label: "脂肪",
      value: summaryMap.get("脂肪") || "-",
      percent: profile.nutrientSharePercent?.fat ?? fallbackPercent(fatValue, 60),
      color: "#059669",
    },
    {
      label: "碳水",
      value: summaryMap.get("碳水") || "-",
      percent: profile.nutrientSharePercent?.carbs ?? fallbackPercent(carbsValue, 300),
      color: "#7c3aed",
    },
  ];

  return items.map((item) => ({
    ...item,
    nutrientKey: NUTRIENT_LABEL_TO_KEY[item.label] || item.label,
    ringPercent: Math.max(0, Math.min(Number(item.percent || 0), 100)),
    percentText: `${Number(item.percent || 0).toFixed(1)}%`,
  }));
}

function buildPieGradient(items) {
  if (!items.length) return "#edf2f7";
  let cursor = 0;
  const stops = items.map((item) => {
    const start = cursor;
    cursor += Number(item.percent || 0);
    return `${item.color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function formatBreakdownValue(value, unit) {
  const normalized = Number(value || 0);
  const text = unit === "kcal" ? normalized.toFixed(0) : normalized.toFixed(1);
  return unit === "kcal" ? `${text} kcal` : `${text}g`;
}

function renderNutrientBreakdownContent(breakdown) {
  if (!breakdown?.hasData) {
    return `
      <div class="nutrient-breakdown-empty">
        暂时无法按食材拆分${breakdown?.label || "营养"}。<br />
        请确认原材料已填写用量，且对应食材已在食材库中有营养数据。
      </div>
    `;
  }

  return `
    <div class="nutrient-breakdown-chart-wrap">
      <div class="nutrient-breakdown-pie" style="background: radial-gradient(circle at center, #fff 0 52%, transparent 53% 100%), ${buildPieGradient(breakdown.items)};">
        <div class="nutrient-breakdown-pie-inner">
          <p class="nutrient-breakdown-pie-value">${formatBreakdownValue(breakdown.total, breakdown.unit)}</p>
          <p class="nutrient-breakdown-pie-label">合计 ${breakdown.label}</p>
        </div>
      </div>
    </div>
    <div class="nutrient-breakdown-list">
      ${renderList(
        breakdown.items,
        (item) => `
          <article class="nutrient-breakdown-item">
            <span class="nutrient-breakdown-dot" style="background: ${item.color};"></span>
            <div class="nutrient-breakdown-item-main">
              <p class="nutrient-breakdown-item-name">${item.name}</p>
              <p class="nutrient-breakdown-item-amount">${item.amount}</p>
            </div>
            <div class="nutrient-breakdown-item-stats">
              <p class="nutrient-breakdown-item-value">${formatBreakdownValue(item.value, breakdown.unit)}</p>
              <p class="nutrient-breakdown-item-percent">${item.percent}%</p>
            </div>
          </article>
        `,
      )}
    </div>
  `;
}

function openNutrientBreakdownModal(recipe, nutrientKey) {
  if (!nutrientBreakdownModal || !recipe) return;

  const builder = window.nutritionProfileBuilder;
  const breakdown = builder?.getIngredientNutrientBreakdown
    ? builder.getIngredientNutrientBreakdown(recipe, nutrientKey, {
        ingredientDetails: window.ingredientDetails,
        catalogIngredients: catalog.ingredients,
      })
    : null;

  if (!breakdown) return;

  nutrientBreakdownModal.style.setProperty("--nutrient-accent", breakdown.color);
  if (nutrientBreakdownTitle) {
    nutrientBreakdownTitle.textContent = `${breakdown.label}来源`;
  }
  if (nutrientBreakdownSubtitle) {
    nutrientBreakdownSubtitle.textContent = breakdown.hasData
      ? `按已识别食材与用量估算，共 ${formatBreakdownValue(breakdown.total, breakdown.unit)}，扇形占比代表各食材贡献。`
      : "以下食材尚未录入营养数据，或缺少可换算的用量。";
  }
  if (nutrientBreakdownBody) {
    nutrientBreakdownBody.innerHTML = renderNutrientBreakdownContent(breakdown);
  }

  nutrientBreakdownModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeNutrientBreakdownModal() {
  if (!nutrientBreakdownModal) return;
  nutrientBreakdownModal.hidden = true;
  document.body.style.overflow = "";
}

function bindSummaryRingInteractions(recipe) {
  detailRoot.querySelectorAll("[data-nutrient-key]").forEach((card) => {
    const open = () => openNutrientBreakdownModal(recipe, card.dataset.nutrientKey);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  });
}

function getFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITE_KEY, JSON.stringify([...favorites]));
}

function isFavorited(recipeId) {
  return getFavorites().has(recipeId);
}

function toggleFavorite(recipeId) {
  const favorites = getFavorites();
  if (favorites.has(recipeId)) {
    favorites.delete(recipeId);
  } else {
    favorites.add(recipeId);
  }
  saveFavorites(favorites);
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

function addRecipeToShoppingList(recipe) {
  const now = new Date().toISOString();
  const existing = new Map(getShoppingList().map((item) => [item.id, item]));
  let addedCount = 0;

  (recipe.ingredients || []).forEach((group) => {
    (group.items || []).forEach((item) => {
      const name = String(item.name || "").trim();
      if (!name) return;

      const id = normalizeShoppingName(name);
      const nextAmount = String(item.amount || "").trim();
      const current = existing.get(id);
      addedCount += 1;

      if (!current) {
        existing.set(id, {
          id,
          name,
          amounts: nextAmount ? [nextAmount] : [],
          sources: [recipe.name],
          checked: false,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      existing.set(id, {
        ...current,
        name,
        amounts: mergeUniqueValues(current.amounts, nextAmount ? [nextAmount] : []),
        sources: mergeUniqueValues(current.sources, [recipe.name]),
        checked: false,
        updatedAt: now,
      });
    });
  });

  saveShoppingList([...existing.values()]);
  return addedCount;
}

function updateShoppingItem(id, updater) {
  const list = getShoppingList();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  const nextItem = updater(list[index]);
  if (!nextItem) return;
  list[index] = {
    ...list[index],
    ...nextItem,
    updatedAt: new Date().toISOString(),
  };
  saveShoppingList(list);
}

function getCookCounts() {
  try {
    return JSON.parse(localStorage.getItem(COOK_COUNT_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCookCounts(counts) {
  localStorage.setItem(COOK_COUNT_KEY, JSON.stringify(counts));
}

function getCookCount(recipeId) {
  const counts = getCookCounts();
  return Number(counts[recipeId] || 0);
}

function setCookCount(recipeId, value) {
  const counts = getCookCounts();
  counts[recipeId] = Math.max(0, Number(value) || 0);
  saveCookCounts(counts);
}

function renderIngredients(recipe) {
  if (!recipe.ingredients.length) return renderEmpty("暂无原材料信息。");

  return `
    <div class="detail-section">
      <div class="detail-subtitle-row">
        <h4 class="detail-subtitle">原材料</h4>
        <button class="action-link detail-inline-action" type="button" data-shopping-add-all="${recipe.id}">
          加入购物清单
        </button>
      </div>
      <div class="ingredient-groups">
        ${renderList(
          recipe.ingredients,
          (group) => `
            <article class="ingredient-group">
              <div class="ingredient-group-head">
                <h5 class="ingredient-group-title">
                  <span class="ingredient-group-title-badge">${group.group}</span>
                </h5>
                <span class="ingredient-count-pill">${group.items.length} 种</span>
              </div>
              <ul class="ingredient-list">
                ${renderList(
                  group.items,
                  (item) => `
                    <li class="ingredient-item">
                      ${
                        getIngredientLink(item.name)
                          ? `<a class="ingredient-name ingredient-link" href="${getIngredientLink(item.name)}">${item.name}</a>`
                          : `<span class="ingredient-name">${item.name}</span>`
                      }
                      <span class="ingredient-amount">${item.amount}</span>
                    </li>
                  `
                )}
              </ul>
            </article>
          `
        )}
      </div>
    </div>
  `;
}

function getCookCountActionLabel(action) {
  return action === "add" ? "我做完了 +1" : "减少一次 -1";
}

function renderCookCount(recipe) {
  const cookCount = getCookCount(recipe.id);

  return `
    <div class="detail-section cook-count-section">
      <div class="detail-subtitle-row">
        <h4 class="detail-subtitle">已做次数</h4>
        <span class="section-note">本地记录，点击按钮会弹出确认框</span>
      </div>
      <div class="cook-count-card">
        <div class="cook-count-display">
          <span class="cook-count-number">${cookCount}</span>
          <span class="cook-count-label">次</span>
        </div>
        <p class="cook-count-tip">每次做完这道菜，可以点一次 +1 记录；减少次数也会先确认。</p>
        <div class="cook-count-actions">
          <button class="cook-count-button add" type="button" data-cook-action="add">
            ${getCookCountActionLabel("add")}
          </button>
          <button class="cook-count-button remove" type="button" data-cook-action="remove" ${cookCount <= 0 ? "disabled" : ""}>
            ${getCookCountActionLabel("remove")}
          </button>
        </div>
      </div>
    </div>
  `;
}

function handleCookCountAction(recipe, action) {
  const currentCount = getCookCount(recipe.id);
  const confirmed = window.confirm(
    action === "add"
      ? `确认把「${recipe.name}」的已做次数加 1 吗？\n\n当前次数：${currentCount} 次`
      : `确认把「${recipe.name}」的已做次数减 1 吗？\n\n当前次数：${currentCount} 次`
  );

  if (!confirmed) return;

  const nextCount = action === "add" ? currentCount + 1 : Math.max(0, currentCount - 1);
  setCookCount(recipe.id, nextCount);
  renderRecipeDetail(recipe);
}

function renderSummaryRings(recipe) {
  const items = getSummaryRingItems(recipe);

  return `
    <div class="summary-ring-grid">
      ${renderList(
        items,
        (item) => `
          <article
            class="summary-ring-card is-clickable"
            style="--ring-color: ${item.color};"
            data-nutrient-key="${item.nutrientKey}"
            role="button"
            tabindex="0"
            aria-label="查看${item.label}来源"
          >
            <div class="summary-ring" style="--progress: ${item.ringPercent}; --ring-color: ${item.color};">
              <div class="summary-ring-inner">
                <span class="summary-ring-value">${item.value}</span>
                <span class="summary-ring-percent">${item.percentText}</span>
              </div>
            </div>
            <p class="summary-ring-label">${item.label}</p>
            <p class="summary-ring-hint">点击查看来源</p>
          </article>
        `
      )}
    </div>
  `;
}

function renderSteps(recipe) {
  if (!recipe.steps.length) return renderEmpty("暂无做法步骤。");

  return `
    <div class="detail-section">
      <h4 class="detail-subtitle">做法</h4>
      <div class="step-list">
        ${renderList(
          recipe.steps,
          (step, index) => `
            <article class="step">
              <div class="step-index">${index + 1}</div>
              <div>
                <h5 class="step-title">${step.title}</h5>
                <p class="step-content">${step.content}</p>
                <div class="step-meta">
                  <span class="mini-tag">建议用时 ${step.time}</span>
                </div>
              </div>
            </article>
          `
        )}
      </div>
    </div>
  `;
}

function renderNutrition(recipe) {
  if (!recipe.nutrition.length) return renderEmpty("暂无营养信息。");

  return `
    <div class="detail-section">
      <h4 class="detail-subtitle">营养信息</h4>
      <div class="nutrition-grid">
        ${renderList(
          recipe.nutrition,
          (item) => `
            <article class="nutrition-card">
              <p class="nutrition-label">${item.label}</p>
              <p class="nutrition-value">${item.value}<span class="nutrition-unit"> ${item.unit}</span></p>
            </article>
          `
        )}
      </div>
    </div>
  `;
}

function renderNutritionAnalysis(recipe) {
  const profile = recipe.nutritionProfile;
  if (!profile) return "";

  const rows = recipe.nutrition.map((item) => {
    const key = item.label === "蛋白质" ? "protein" : item.label === "脂肪" ? "fat" : item.label === "碳水" ? "carbs" : item.label === "膳食纤维" ? "fiber" : null;
    const per100g = key ? profile.per100g[key] : null;
    const percent = key ? profile.nutrientSharePercent[key] : null;
    return {
      label: item.label,
      perServing: item.value,
      per100g: per100g == null ? "-" : per100g,
      percent: percent == null ? "-" : `${percent}%`,
    };
  });

  const levelClass =
    profile.foodGrade.level === "红灯"
      ? "red"
      : profile.foodGrade.level === "黄灯"
        ? "yellow"
        : "green";

  return `
    <div class="detail-section">
      <div class="detail-subtitle-row">
        <h4 class="detail-subtitle">营养解读</h4>
        <span class="section-note">按 2000 kcal / 天参考值计算</span>
      </div>
      <div class="nutrition-analysis-grid">
        <article class="nutrition-analysis-card">
          <p class="nutrition-label">每100g热量</p>
          <p class="analysis-value">${profile.per100g.calories}<span class="nutrition-unit"> kcal</span></p>
          <p class="metric-sub">对应食材密度：${profile.servingWeightG}g / 份</p>
        </article>
        <article class="nutrition-analysis-card">
          <p class="nutrition-label">每份热量</p>
          <p class="analysis-value">${recipe.calories.perServing}<span class="nutrition-unit"> kcal</span></p>
          <p class="metric-sub">约占每日需求 ${profile.energySharePercent}%</p>
        </article>
        <article class="nutrition-analysis-card">
          <p class="nutrition-label">能量占比</p>
          <p class="analysis-value">${profile.energySharePercent}<span class="nutrition-unit">%</span></p>
          <p class="metric-sub">这一份提供的能量比例</p>
        </article>
        <article class="nutrition-analysis-card food-grade ${levelClass}">
          <p class="nutrition-label">食物等级</p>
          <p class="analysis-value">${profile.foodGrade.level}</p>
          <p class="metric-sub">${profile.foodGrade.tone}</p>
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
          rows,
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
    </div>
  `;
}

function renderTips(recipe) {
  if (!recipe.tips.length) return renderEmpty("暂无小贴士。");

  return `
    <div class="detail-section">
      <h4 class="detail-subtitle">小贴士</h4>
      <div class="tips">
        ${renderList(
          recipe.tips,
          (tip) => `
            <article class="tip">
              <strong>${tip.title}</strong>
              <div>${tip.content}</div>
            </article>
          `
        )}
      </div>
    </div>
  `;
}

function renderRelated(recipe) {
  const related = getRelatedRecipes(recipe);

  if (!related.length) {
    return renderEmpty("暂无相关推荐。");
  }

  return `
    <div class="detail-section">
      <div class="detail-subtitle-row">
        <h4 class="detail-subtitle">相关推荐</h4>
        <span class="section-note">按分类和标签相似度推荐</span>
      </div>
      <div class="related-grid">
        ${renderList(
          related,
          (item) => `
            <a class="related-card" href="./recipe.html?id=${encodeURIComponent(item.id)}">
              <div class="related-card-cover" style="background-image: linear-gradient(180deg, rgba(31,41,55,0.05), rgba(31,41,55,0.38)), url('${item.coverImage}')"></div>
              <div class="related-card-body">
                <h5 class="related-card-title">${item.name}</h5>
                <p class="related-card-desc">${item.desc}</p>
                <div class="related-card-meta">
                  <span>${item.statusTags[0]}</span>
                  <span>${item.summary[0].value}</span>
                </div>
              </div>
            </a>
          `
        )}
      </div>
    </div>
  `;
}

function openDeleteRecipeModal(recipe) {
  if (!deleteRecipeModal || !recipe) return;

  pendingDeleteRecipe = recipe;
  if (deleteRecipeName) deleteRecipeName.textContent = recipe.name;
  if (deleteRecipeHint) {
    deleteRecipeHint.textContent = contentApi.isRemoteConfigured()
      ? "此操作需要管理员权限，并会同步到线上数据。"
      : "此操作会在当前浏览器中隐藏该菜谱。";
  }

  deleteRecipeModal.hidden = false;
  document.body.style.overflow = "hidden";
  if (confirmDeleteRecipeBtn) {
    confirmDeleteRecipeBtn.disabled = false;
    confirmDeleteRecipeBtn.textContent = "确认删除";
    confirmDeleteRecipeBtn.focus();
  }
}

function closeDeleteRecipeModal() {
  if (!deleteRecipeModal) return;
  deleteRecipeModal.hidden = true;
  document.body.style.overflow = "";
  pendingDeleteRecipe = null;
}

async function confirmDeleteRecipe() {
  if (!pendingDeleteRecipe || !contentApi.deleteContent || !confirmDeleteRecipeBtn) return;

  const recipe = pendingDeleteRecipe;
  confirmDeleteRecipeBtn.disabled = true;
  confirmDeleteRecipeBtn.textContent = "正在删除...";

  try {
    await contentApi.deleteContent("recipe", recipe.id);
    closeDeleteRecipeModal();
    window.uiToast?.show(`已删除「${recipe.name}」`, { type: "success", duration: 1200 });
    window.setTimeout(() => {
      window.location.href = "./recipes.html";
    }, 450);
  } catch (error) {
    confirmDeleteRecipeBtn.disabled = false;
    confirmDeleteRecipeBtn.textContent = "确认删除";
    window.uiToast?.show(error?.message || "删除失败", { type: "error", duration: 2000 });
  }
}

function renderPageToolbar(recipe) {
  if (!detailToolbar) return;

  const { prevId, nextId } = getAdjacentRecipeIds(recipe.id);
  const favoriteActive = isFavorited(recipe.id);
  const editLink = contentApi.canEdit() ? contentApi.getEditLink("recipe", recipe.id) : "";
  const newRecipeLink = contentApi.canEdit() && contentApi.getNewRecipeLink
    ? contentApi.getNewRecipeLink()
    : "";
  const moreItems = [
    newRecipeLink ? `<a class="admin-menu-item" href="${newRecipeLink}">新建菜谱</a>` : "",
    contentApi.canEdit() ? `<button class="admin-menu-item toolbar-danger" type="button" id="deleteRecipeBtn">删除菜谱</button>` : "",
  ].filter(Boolean).join("");

  detailToolbar.innerHTML = `
    <div class="page-toolbar-group">
      <a class="toolbar-link" href="./recipe.html?id=${encodeURIComponent(prevId)}">← 上一个</a>
      <a class="toolbar-link" href="./recipe.html?id=${encodeURIComponent(nextId)}">下一个 →</a>
    </div>
    <div class="page-toolbar-group">
      <button class="favorite-button ${favoriteActive ? "is-active" : ""}" type="button" data-favorite-id="${recipe.id}">
        ${favoriteActive ? "♥ 已收藏" : "♡ 收藏"}
      </button>
      ${editLink ? `<a class="action-link" href="${editLink}">编辑</a>` : ""}
      ${moreItems ? `
        <details class="toolbar-more">
          <summary class="action-link">更多</summary>
          <div class="toolbar-more-panel">${moreItems}</div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderRecipeDetail(recipe) {
  if (!recipe) {
    detailRoot.innerHTML = renderEmpty("没有找到对应的菜谱。");
    recipeBreadcrumb.textContent = "菜谱详情";
    if (detailToolbar) detailToolbar.innerHTML = "";
    currentRenderedRecipe = null;
    return;
  }

  recipe = getRecipeWithNutritionProfile(recipe);
  currentRenderedRecipe = recipe;
  document.title = `${recipe.name} - 菜谱详情`;
  recipeBreadcrumb.textContent = recipe.name;
  renderPageToolbar(recipe);

  detailRoot.innerHTML = `
    <article class="detail-layout">
      <section class="detail-cover" style="background-image: linear-gradient(180deg, rgba(31,41,55,0.04), rgba(31,41,55,0.52)), url('${recipe.coverImage}')">
        <div class="cover-fallback-note" aria-hidden="true">封面未加载，已使用默认背景</div>
        <div class="badge-row">
          ${recipe.tags.map((tag) => `<span class="badge"># ${tag}</span>`).join("")}
        </div>
        <h3 class="detail-title">${recipe.name}</h3>
        ${recipe.calories.note ? `<p class="detail-subline">${recipe.calories.note}</p>` : ""}
        <p class="detail-desc">${recipe.desc}</p>
        ${renderSummaryRings(recipe)}
        ${renderNutritionAnalysis(recipe)}
      </section>

      <section class="detail-content">
        <div class="toolbar">
          ${recipe.statusTags.map((tag) => `<span class="chip">${tag}</span>`).join("")}
        </div>

        <div class="metrics">
          <article class="metric">
            <p class="metric-label">食材数</p>
            <p class="metric-value">${recipe.ingredientCount}</p>
          </article>
          <article class="metric">
            <p class="metric-label">所属分类</p>
            <p class="metric-value">${recipe.categories.length}</p>
          </article>
          <article class="metric">
            <p class="metric-label">每份热量</p>
            <p class="metric-value">${recipe.calories.perServing}</p>
          </article>
          <article class="metric">
            <p class="metric-label">上次修改时间</p>
            <p class="metric-value">${formatDateTime(recipe.updatedAt)}</p>
          </article>
        </div>

        ${renderCookCount(recipe)}
        ${renderIngredients(recipe)}
        ${renderSteps(recipe)}
        ${renderTips(recipe)}
        ${renderRelated(recipe)}
      </section>
    </article>
  `;

  const favoriteButton = detailToolbar?.querySelector("[data-favorite-id]");
  if (favoriteButton) {
    favoriteButton.addEventListener("click", () => {
      toggleFavorite(recipe.id);
      renderRecipeDetail(recipe);
    });
  }

  const deleteButton = detailToolbar?.querySelector("#deleteRecipeBtn");
  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      openDeleteRecipeModal(recipe);
    });
  }

  const cookButtons = detailRoot.querySelectorAll("[data-cook-action]");
  cookButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.cookAction;
      handleCookCountAction(recipe, action);
    });
  });

  const shoppingButton = detailRoot.querySelector("[data-shopping-add-all]");
  if (shoppingButton) {
    shoppingButton.addEventListener("click", () => {
      const addedCount = addRecipeToShoppingList(recipe);
      window.uiToast?.show(
        addedCount ? `已加入购物清单 ${addedCount} 项` : "这道菜没有可加入的原材料",
        { type: "success", duration: 1000 }
      );
    });
  }

  syncCoverImageState(recipe);
  bindSummaryRingInteractions(recipe);
}

function syncCoverImageState(recipe) {
  const cover = detailRoot.querySelector(".detail-cover");
  if (!cover) return;

  const imageUrl = String(recipe.coverImage || "").trim();
  if (!imageUrl) {
    cover.classList.add("cover-image-fallback");
    return;
  }

  const img = new Image();
  img.onload = () => cover.classList.remove("cover-image-fallback");
  img.onerror = () => cover.classList.add("cover-image-fallback");
  img.src = imageUrl;
}

(async function init() {
  if (deleteRecipeModal) {
    deleteRecipeModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-delete-modal]")) {
        closeDeleteRecipeModal();
      }
    });
  }

  confirmDeleteRecipeBtn?.addEventListener("click", confirmDeleteRecipe);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && deleteRecipeModal && !deleteRecipeModal.hidden) {
      closeDeleteRecipeModal();
    }
    if (event.key === "Escape" && nutrientBreakdownModal && !nutrientBreakdownModal.hidden) {
      closeNutrientBreakdownModal();
    }
  });

  nutrientBreakdownModal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-nutrient-modal]")) {
      closeNutrientBreakdownModal();
    }
  });

  if (contentApi?.listRecipes) {
    const remoteList = await contentApi.listRecipes();
    if (Array.isArray(remoteList) && remoteList.length > 0) {
      contentApi.mergeCatalogRecipes(catalog, remoteList);
    }
  }

  if (contentApi?.syncCatalogIngredients) {
    await contentApi.syncCatalogIngredients(catalog);
  }

  const recipe = await contentApi.loadContent("recipe", getRecipeIdFromQuery());
  if (recipe?.ingredientNames?.length && contentApi.applyRecipeIngredientLinks) {
    contentApi.applyRecipeIngredientLinks(recipe.ingredientNames);
  }
  renderRecipeDetail(recipe);
})();
