const catalog = window.recipeCatalog;
const api = window.contentApi;

if (!catalog) {
  throw new Error("recipeCatalog 未加载，请先在 HTML 中引入 data.js");
}

const state = {
  query: "",
  ingredientQuery: "",
  ingredientMode: "all",
  category: "all",
  searchMode: "recipe",
  ingredientChipsExpanded: false,
  previewOpen: false,
  selectedId: catalog.defaultRecipeId,
};

const searchInput = document.getElementById("recipeSearch");
const fridgeIngredientsInput = document.getElementById("fridgeIngredients");
const ingredientSearchBtn = document.getElementById("ingredientSearchBtn");
const searchHints = document.getElementById("searchHints");
const categoryChips = document.getElementById("categoryChips");
const ingredientModeChips = document.getElementById("ingredientModeChips");
const ingredientChips = document.getElementById("ingredientChips");
const ingredientMoreBtn = document.getElementById("ingredientMoreBtn");
const resultCount = document.getElementById("resultCount");
const ingredientResultCount = document.getElementById("ingredientResultCount");
const recipeGrid = document.getElementById("recipeGrid");
const detailPanel = document.getElementById("detailPanel");
const previewSection = document.getElementById("previewSection");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const searchModeTabs = document.getElementById("searchModeTabs");
const recipeSearchPanel = document.getElementById("recipeSearchPanel");
const ingredientSearchPanel = document.getElementById("ingredientSearchPanel");

const INGREDIENT_CHIP_LIMIT = 6;

document.title = "菜谱搜索页";

async function syncRecipeCatalog() {
  if (!api?.listRecipes) return;
  const remoteList = await api.listRecipes();
  if (Array.isArray(remoteList) && remoteList.length > 0) {
    api.mergeCatalogRecipes(catalog, remoteList);
  }
}

function renderEmpty(message) {
  return `<div class="empty-state">${message}</div>`;
}

function renderList(items, renderItem) {
  return items.map(renderItem).join("");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，,、；;|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitQueryTokens(query) {
  return normalizeText(query)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getIngredientTokens() {
  return splitQueryTokens(state.ingredientQuery);
}

function getCategoryLabel(id) {
  const category = catalog.categories.find((item) => item.id === id);
  return category ? category.label : id;
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

function getRecipeById(id) {
  return catalog.recipes.find((recipe) => recipe.id === id) || null;
}

function getUniqueIngredientNames() {
  return catalog.ingredients.map((ingredient) => ingredient.name);
}

function getVisibleIngredientNames() {
  const names = getUniqueIngredientNames();
  if (state.ingredientChipsExpanded || names.length <= INGREDIENT_CHIP_LIMIT) {
    return names;
  }
  return names.slice(0, INGREDIENT_CHIP_LIMIT);
}

function getRecipeSearchText(recipe) {
  const ingredientNames = (recipe.ingredientNames || []).join(" ");
  return [
    recipe.name,
    recipe.desc,
    recipe.tags.join(" "),
    ingredientNames,
    getCategoryLabel(recipe.categories[0] || ""),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesRecipeQuery(recipe, query) {
  const tokens = splitQueryTokens(query);
  if (tokens.length === 0) return true;
  const searchText = getRecipeSearchText(recipe);
  return tokens.every((token) => searchText.includes(token));
}

function scoreRecipeByIngredients(recipe, tokens) {
  const ingredientNames = recipe.ingredientNames || [];
  if (tokens.length === 0) {
    return {
      matchedCount: 0,
      totalCount: ingredientNames.length,
      matchedNames: [],
      missingNames: ingredientNames,
      direct: false,
      nearMatch: false,
      score: 0,
    };
  }

  const normalizedNames = ingredientNames.map((name) => ({ raw: name, value: normalizeText(name) }));
  const matchedNames = [];

  tokens.forEach((token) => {
    const matched = normalizedNames.find((item) => item.value.includes(token) || token.includes(item.value));
    if (matched && !matchedNames.includes(matched.raw)) {
      matchedNames.push(matched.raw);
    }
  });

  const missingNames = ingredientNames.filter((name) => !matchedNames.includes(name));
  const totalCount = ingredientNames.length;
  const matchedCount = matchedNames.length;
  const missingCount = Math.max(0, totalCount - matchedCount);

  return {
    matchedCount,
    totalCount,
    matchedNames,
    missingNames,
    direct: totalCount > 0 && matchedCount === totalCount,
    nearMatch: matchedCount > 0 && missingCount > 0 && missingCount <= 2,
    score: totalCount === 0 ? 0 : matchedCount / totalCount,
  };
}

function getFilteredRecipes() {
  const query = state.query.trim().toLowerCase();
  const ingredientTokens = getIngredientTokens();

  return catalog.recipes
    .map((recipe) => ({
      recipe,
      ingredientMatch: scoreRecipeByIngredients(recipe, ingredientTokens),
    }))
    .filter(({ recipe, ingredientMatch }) => {
      const matchesCategory = state.category === "all" || recipe.categories.includes(state.category);
      const matchesQuery = !query || matchesRecipeQuery(recipe, query);
      const matchesIngredients = ingredientTokens.length === 0 || ingredientMatch.matchedCount > 0;
      const matchesMode =
        state.ingredientMode === "all" ||
        ingredientTokens.length === 0 ||
        (state.ingredientMode === "direct" && ingredientMatch.direct) ||
        (state.ingredientMode === "near" && ingredientMatch.nearMatch);
      return matchesCategory && matchesQuery && matchesIngredients && matchesMode;
    })
    .sort((a, b) => {
      if (ingredientTokens.length > 0) {
        if (b.ingredientMatch.score !== a.ingredientMatch.score) {
          return b.ingredientMatch.score - a.ingredientMatch.score;
        }
        if (b.ingredientMatch.matchedCount !== a.ingredientMatch.matchedCount) {
          return b.ingredientMatch.matchedCount - a.ingredientMatch.matchedCount;
        }
      }

      return a.recipe.calories.perServing - b.recipe.calories.perServing;
    });
}

function renderSearchModeTabs() {
  if (!searchModeTabs) return;

  searchModeTabs.querySelectorAll("[data-search-mode]").forEach((button) => {
    const active = button.dataset.searchMode === state.searchMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (recipeSearchPanel) {
    recipeSearchPanel.hidden = state.searchMode !== "recipe";
  }
  if (ingredientSearchPanel) {
    ingredientSearchPanel.hidden = state.searchMode !== "ingredient";
  }
}

function renderSearchHints() {
  if (!searchHints) return;

  searchHints.innerHTML = `
    <span class="search-hints-label">热门：</span>
    ${renderList(
      catalog.searchHints,
      (hint) => `<button class="hint-chip hint-chip-light" type="button" data-hint="${hint}">${hint}</button>`,
    )}
  `;
}

function renderCategoryChips() {
  categoryChips.innerHTML = renderList(
    catalog.categories,
    (category) => `
      <button class="category-chip ${state.category === category.id ? "active" : ""}" type="button" data-category="${category.id}">
        ${category.label}
      </button>
    `,
  );
}

function renderIngredientModeChips() {
  const modes = [
    { id: "all", label: "全部" },
    { id: "direct", label: "可直接做" },
    { id: "near", label: "缺少 1-2 样" },
  ];

  ingredientModeChips.innerHTML = renderList(
    modes,
    (mode) => `
      <button class="ingredient-mode-chip ${state.ingredientMode === mode.id ? "active" : ""}" type="button" data-mode="${mode.id}">
        ${mode.label}
      </button>
    `,
  );
}

function renderIngredientChips() {
  const selectedTokens = new Set(getIngredientTokens());
  const visibleNames = getVisibleIngredientNames();
  const totalNames = getUniqueIngredientNames().length;

  ingredientChips.innerHTML = renderList(
    visibleNames,
    (name) => `
      <button class="ingredient-chip ${selectedTokens.has(normalizeText(name)) ? "active" : ""}" type="button" data-ingredient="${name}">
        ${name}
      </button>
    `,
  );

  if (ingredientMoreBtn) {
    const canExpand = totalNames > INGREDIENT_CHIP_LIMIT;
    ingredientMoreBtn.hidden = !canExpand;
    ingredientMoreBtn.textContent = state.ingredientChipsExpanded
      ? "收起食材"
      : `更多食材（${totalNames - INGREDIENT_CHIP_LIMIT}+）`;
  }
}

function renderResultCounts(filtered) {
  const ingredientTokens = getIngredientTokens();
  const countText = ingredientTokens.length > 0
    ? `找到 ${filtered.length} 个菜谱，已输入 ${ingredientTokens.length} 个食材`
    : `找到 ${filtered.length} 个菜谱`;

  if (resultCount) resultCount.textContent = countText;
  if (ingredientResultCount) ingredientResultCount.textContent = countText;
}

function renderPreviewSection(filtered) {
  if (!previewSection) return;

  previewSection.hidden = !state.previewOpen;
  if (!state.previewOpen) {
    if (detailPanel) detailPanel.innerHTML = "";
    return;
  }

  const selectedResult = filtered.find((item) => item.recipe.id === state.selectedId);
  renderDetail(
    selectedResult ? selectedResult.recipe : null,
    selectedResult ? selectedResult.ingredientMatch : null,
  );
}

function renderRecipeCard(result) {
  const recipe = result.recipe || result;
  const match = result.ingredientMatch || null;
  const active = state.previewOpen && recipe.id === state.selectedId ? "active" : "";

  return `
    <div class="recipe-card ${active}" role="button" tabindex="0" data-recipe-id="${recipe.id}" aria-label="预览 ${recipe.name}">
      <div class="recipe-card-cover" data-cover-url="${recipe.coverImage}" style="background-image: linear-gradient(180deg, rgba(31,41,55,0.04), rgba(31,41,55,0.36)), url('${recipe.coverImage}')">
        <div class="recipe-card-cover-note" aria-hidden="true">封面未加载</div>
        <a class="recipe-card-cover-link action-link" href="./recipe.html?id=${encodeURIComponent(recipe.id)}">打开完整详情页</a>
      </div>
      <div class="recipe-card-body">
        <div class="recipe-card-tags">
          ${recipe.tags.map((tag) => `<span class="tag"># ${tag}</span>`).join("")}
        </div>
        <h3 class="recipe-card-title">${recipe.name}</h3>
        <p class="recipe-card-desc">${recipe.desc}</p>
        <div class="recipe-card-meta">
          <span>${recipe.statusTags[0]}</span>
          <span>${recipe.summary[0].value}</span>
          ${
            match && match.matchedCount > 0
              ? `<span class="recipe-match-badge">${match.direct ? "可直接做" : `食材匹配 ${match.matchedCount}/${match.totalCount}`}</span>`
              : ""
          }
        </div>
        ${
          match && match.missingNames.length > 0
            ? `<p class="recipe-missing-text">还差：${match.missingNames.slice(0, 3).join("、")}${match.missingNames.length > 3 ? " 等" : ""}</p>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderRecipeGrid(results) {
  recipeGrid.innerHTML = results.length
    ? renderList(results, renderRecipeCard)
    : renderEmpty("没有找到匹配的菜谱，试试换个关键词或分类。");
}

function syncRecipeCardCovers() {
  const covers = recipeGrid.querySelectorAll(".recipe-card-cover");
  covers.forEach((cover) => {
    const imageUrl = String(cover.dataset.coverUrl || "").trim();
    if (!imageUrl) {
      cover.classList.add("cover-image-fallback");
      return;
    }

    const img = new Image();
    img.onload = () => cover.classList.remove("cover-image-fallback");
    img.onerror = () => cover.classList.add("cover-image-fallback");
    img.src = imageUrl;
  });
}

function syncPreviewCoverState(recipe) {
  const cover = detailPanel.querySelector(".detail-cover");
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

function renderDetail(recipe, ingredientMatch = null) {
  if (!recipe) {
    detailPanel.innerHTML = renderEmpty("没有可预览的菜谱。");
    return;
  }

  const commonIngredients = (recipe.ingredientNames || []).slice(0, 8);

  detailPanel.innerHTML = `
    <article class="detail-layout home-preview-layout">
      <section class="detail-cover" style="background-image: linear-gradient(180deg, rgba(17,24,39,0.28), rgba(17,24,39,0.78)), url('${recipe.coverImage}')">
        <div class="cover-fallback-note" aria-hidden="true">封面未加载，已使用默认背景</div>
        <div class="preview-copy">
          <div class="badge-row">
            ${recipe.tags.map((tag) => `<span class="badge"># ${tag}</span>`).join("")}
          </div>
          <h3 class="detail-title">${recipe.name}</h3>
          <p class="detail-desc">${recipe.desc}</p>
        </div>
        <div class="summary-grid">
          ${renderList(
            recipe.summary,
            (item) => `
              <article class="summary-card">
                <p class="summary-label">${item.label}</p>
                <p class="summary-value">${item.value}</p>
              </article>
            `,
          )}
        </div>
      </section>

      <section class="detail-content">
        <div class="detail-preview-header">
          <div>
            <h4 class="detail-subtitle">菜谱摘要</h4>
          </div>
          <a class="action-link" href="./recipe.html?id=${encodeURIComponent(recipe.id)}">查看完整详情</a>
        </div>

        <section class="preview-panel preview-panel-stats">
          <div class="toolbar">
            ${recipe.statusTags.map((tag) => `<span class="chip">${tag}</span>`).join("")}
          </div>

          <div class="metrics preview-metrics">
            <article class="metric">
              <p class="metric-label">食材数</p>
              <p class="metric-value">${recipe.ingredientCount}</p>
            </article>
            <article class="metric">
              <p class="metric-label">分类数</p>
              <p class="metric-value">${recipe.categories.length}</p>
            </article>
            <article class="metric">
              <p class="metric-label">每份热量</p>
              <p class="metric-value">${recipe.calories.perServing}</p>
            </article>
          </div>

          <article class="calorie-banner">
            <p class="nutrition-label">快速预览</p>
            <p class="nutrition-value calorie-value">${recipe.calories.perServing}<span class="nutrition-unit"> ${recipe.calories.unit}</span></p>
            <p class="metric-sub">${recipe.calories.note}</p>
          </article>
        </section>

        ${
          ingredientMatch && ingredientMatch.matchedCount > 0
            ? `
          <section class="preview-panel">
            <div class="detail-subtitle-row">
              <h4 class="detail-subtitle">食材匹配</h4>
              <span class="section-note">基于你输入的冰箱食材</span>
            </div>
            <article class="ingredient-match-card">
              <div class="ingredient-match-stats">
                <div>
                  <p class="nutrition-label">匹配度</p>
                  <p class="analysis-value">${Math.round(ingredientMatch.score * 100)}<span class="nutrition-unit">%</span></p>
                </div>
                <div>
                  <p class="nutrition-label">已匹配 / 总食材</p>
                  <p class="analysis-value">${ingredientMatch.matchedCount}<span class="nutrition-unit"> / ${ingredientMatch.totalCount}</span></p>
                </div>
              </div>
              <div class="ingredient-match-block">
                <p class="nutrition-label">还差这些食材</p>
                <div class="missing-chip-row">
                  ${
                    ingredientMatch.missingNames.length > 0
                      ? ingredientMatch.missingNames
                          .slice(0, 4)
                          .map((name) => `<span class="missing-chip">${name}</span>`)
                          .join("")
                      : '<span class="missing-chip ok">已具备全部食材</span>'
                  }
                </div>
              </div>
            </article>
          </section>
        `
            : ""
        }

        <section class="preview-panel">
          <div class="detail-subtitle-row">
            <h4 class="detail-subtitle">常用食材</h4>
            <span class="section-note">点击可进入食材详情页</span>
          </div>
          <div class="ingredient-chip-row preview-ingredient-row">
            ${renderList(
              commonIngredients,
              (name) => {
                const link = getIngredientLink(name);
                return link
                  ? `<a class="ingredient-chip ingredient-link" href="${link}">${name}</a>`
                  : `<span class="ingredient-chip">${name}</span>`;
              },
            )}
          </div>
        </section>
      </section>
    </article>
  `;

  syncPreviewCoverState(recipe);
}

function openPreview(recipeId) {
  state.selectedId = recipeId;
  state.previewOpen = true;
  renderAll();
  if (previewSection) {
    previewSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function closePreview() {
  state.previewOpen = false;
  renderAll();
}

function renderAll() {
  const filtered = getFilteredRecipes();

  if (filtered.length > 0 && !filtered.some((item) => item.recipe.id === state.selectedId)) {
    state.selectedId = filtered[0].recipe.id;
  }

  renderSearchModeTabs();
  renderSearchHints();
  renderCategoryChips();
  renderIngredientModeChips();
  renderIngredientChips();
  renderRecipeGrid(filtered);
  syncRecipeCardCovers();
  renderResultCounts(filtered);
  renderPreviewSection(filtered);
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderAll();
});

categoryChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderAll();
});

searchHints.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hint]");
  if (!button) return;
  state.query = button.dataset.hint;
  searchInput.value = state.query;
  renderAll();
});

if (searchModeTabs) {
  searchModeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-mode]");
    if (!button) return;
    state.searchMode = button.dataset.searchMode || "recipe";
    renderAll();
  });
}

ingredientModeChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  state.ingredientMode = button.dataset.mode;
  renderAll();
});

ingredientChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ingredient]");
  if (!button) return;

  const ingredient = button.dataset.ingredient;
  const currentTokens = splitQueryTokens(state.ingredientQuery);
  const normalizedIngredient = normalizeText(ingredient);

  if (currentTokens.includes(normalizedIngredient)) {
    state.ingredientQuery = currentTokens.filter((token) => token !== normalizedIngredient).join(" ");
  } else {
    currentTokens.push(normalizedIngredient);
    state.ingredientQuery = currentTokens.join(" ");
  }

  fridgeIngredientsInput.value = state.ingredientQuery;
  renderAll();
});

if (ingredientMoreBtn) {
  ingredientMoreBtn.addEventListener("click", () => {
    state.ingredientChipsExpanded = !state.ingredientChipsExpanded;
    renderIngredientChips();
  });
}

function applyIngredientSearch() {
  state.ingredientQuery = fridgeIngredientsInput.value;
  renderAll();
}

ingredientSearchBtn.addEventListener("click", applyIngredientSearch);

fridgeIngredientsInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applyIngredientSearch();
});

fridgeIngredientsInput.addEventListener("input", () => {
  state.ingredientQuery = fridgeIngredientsInput.value;
  renderAll();
});

if (closePreviewBtn) {
  closePreviewBtn.addEventListener("click", closePreview);
}

(async function init() {
  await syncRecipeCatalog();
  if (api?.syncCatalogIngredients) {
    await api.syncCatalogIngredients(catalog);
  }
  renderAll();
})();

recipeGrid.addEventListener("click", (event) => {
  if (event.target.closest(".recipe-card-cover-link")) return;

  const card = event.target.closest("[data-recipe-id]");
  if (!card) return;

  openPreview(card.dataset.recipeId);
});

recipeGrid.addEventListener("keydown", (event) => {
  const card = event.target.closest("[data-recipe-id]");
  if (!card) return;

  const key = String(event.key || "").toLowerCase();
  if (key !== "enter" && key !== " ") return;

  event.preventDefault();
  openPreview(card.dataset.recipeId);
});
