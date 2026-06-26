const catalog = window.recipeCatalog;
const api = window.contentApi;

if (!catalog) {
  throw new Error("recipeCatalog 未加载，请先在 HTML 中引入 data.js");
}

const state = {
  query: "",
  category: "all",
  canManage: false,
  pendingDeleteIds: [],
};

const searchInput = document.getElementById("recipesSearch");
const categoryChips = document.getElementById("recipesCategoryChips");
const recipesMeta = document.getElementById("recipesMeta");
const recipesGrid = document.getElementById("recipesGrid");
const batchDeleteModal = document.getElementById("batchDeleteModal");
const batchDeleteDesc = document.getElementById("batchDeleteDesc");
const batchDeleteHint = document.getElementById("batchDeleteHint");
const confirmBatchDeleteBtn = document.getElementById("confirmBatchDeleteBtn");

const batchManager = window.listBatchUi?.createBatchManager({
  root: recipesGrid,
  shellSelector: ".recipes-shell",
  itemUnit: "道菜",
  barId: "recipesBatchBar",
  toggleBtnId: "recipesBatchToggleBtn",
  selectAllId: "recipesSelectAll",
  countId: "recipesBatchCount",
  deleteBtnId: "recipesBatchDeleteBtn",
  canManage: false,
  onDelete: (ids) => openBatchDeleteModal(ids, "recipe"),
});

document.title = "全部菜品";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] || char;
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function renderEmpty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
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

function getCategoryLabel(id) {
  const category = catalog.categories.find((item) => item.id === id);
  return category ? category.label : id;
}

function getRecipeSearchText(recipe) {
  const ingredientNames = (recipe.ingredientNames || []).join(" ");
  return normalizeText([
    recipe.name,
    recipe.desc,
    (recipe.tags || []).join(" "),
    ingredientNames,
    (recipe.categories || []).map(getCategoryLabel).join(" "),
  ].join(" "));
}

function filterRecipes() {
  const tokens = normalizeText(state.query).split(" ").filter(Boolean);

  return catalog.recipes
    .filter((recipe) => {
      if (state.category !== "all" && !(recipe.categories || []).includes(state.category)) {
        return false;
      }
      if (!tokens.length) return true;
      const haystack = getRecipeSearchText(recipe);
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
}

function renderCategoryChips() {
  categoryChips.innerHTML = renderList(
    catalog.categories,
    (category) => `
      <button
        class="category-chip ${state.category === category.id ? "active" : ""}"
        type="button"
        data-category="${escapeAttr(category.id)}"
      >
        ${escapeHtml(category.label)}
      </button>
    `,
  );
}

function renderRecipeCard(recipe) {
  const summaryValue = recipe.summary?.[0]?.value || `${recipe.calories?.perServing || "-"} ${recipe.calories?.unit || "千卡"}`;
  const statusTag = recipe.statusTags?.[0] || "查看详情";
  const checkbox = state.canManage
    ? `
      <label class="list-batch-check" aria-label="选择 ${escapeAttr(recipe.name)}">
        <input type="checkbox" data-batch-checkbox data-batch-id="${escapeAttr(recipe.id)}" />
      </label>
    `
    : "";

  return `
    <article class="recipe-card" data-batch-item data-batch-id="${escapeAttr(recipe.id)}">
      ${checkbox}
      <a class="recipe-card-link" href="./recipe.html?id=${encodeURIComponent(recipe.id)}">
        <div class="recipe-card-cover" data-cover-url="${escapeAttr(recipe.coverImage)}" style="background-image: linear-gradient(180deg, rgba(31,41,55,0.04), rgba(31,41,55,0.36)), url('${escapeAttr(recipe.coverImage)}')">
          <div class="recipe-card-cover-note" aria-hidden="true">封面未加载</div>
        </div>
        <div class="recipe-card-body">
          <div class="recipe-card-tags">
            ${(recipe.tags || []).slice(0, 3).map((tag) => `<span class="tag"># ${escapeHtml(tag)}</span>`).join("")}
          </div>
          <h3 class="recipe-card-title">${escapeHtml(recipe.name)}</h3>
          <p class="recipe-card-desc">${escapeHtml(recipe.desc)}</p>
          <div class="recipe-card-meta">
            <span>${escapeHtml(statusTag)}</span>
            <span>${escapeHtml(summaryValue)}</span>
            <span>${escapeHtml((recipe.categories || []).map(getCategoryLabel).slice(0, 2).join(" · ") || "未分类")}</span>
          </div>
        </div>
      </a>
    </article>
  `;
}

function syncRecipeCardCovers() {
  recipesGrid.querySelectorAll(".recipe-card-cover").forEach((cover) => {
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

function renderRecipes() {
  const recipes = filterRecipes();
  const total = catalog.recipes.length;
  const categoryLabel = getCategoryLabel(state.category);

  recipesMeta.textContent = state.category === "all"
    ? `共 ${total} 道菜，当前显示 ${recipes.length} 道`
    : `${categoryLabel} · 共 ${recipes.length} 道菜（全部 ${total} 道）`;

  recipesGrid.innerHTML = recipes.length
    ? renderList(recipes, renderRecipeCard)
    : renderEmpty("没有找到匹配的菜品，试试换个关键词或分类。");

  syncRecipeCardCovers();
  batchManager?.updateUI();
}

function getRecipeNameById(id) {
  return catalog.recipes.find((item) => item.id === id)?.name || id;
}

function openBatchDeleteModal(ids, type) {
  if (!batchDeleteModal || !ids.length) return;
  state.pendingDeleteIds = ids;
  const label = type === "recipe" ? "道菜谱" : "种食材";
  const names = ids.slice(0, 5).map(getRecipeNameById);
  const more = ids.length > 5 ? `等 ${ids.length} ${label}` : "";
  if (batchDeleteDesc) {
    batchDeleteDesc.innerHTML = `即将删除：${names.map((name) => `「${escapeHtml(name)}」`).join("、")}${escapeHtml(more)}。删除后无法恢复。`;
  }
  if (batchDeleteHint) {
    batchDeleteHint.textContent = api.isRemoteConfigured()
      ? "此操作需要管理员权限，并会同步到线上数据。"
      : "将从本机草稿中移除，刷新种子数据后可能再次出现。";
  }
  batchDeleteModal.hidden = false;
  document.body.style.overflow = "hidden";
  confirmBatchDeleteBtn?.focus();
}

function closeBatchDeleteModal() {
  if (!batchDeleteModal) return;
  batchDeleteModal.hidden = true;
  document.body.style.overflow = "";
  state.pendingDeleteIds = [];
}

async function confirmBatchDelete() {
  if (!state.pendingDeleteIds.length || !api?.deleteManyContent) return;
  if (!confirmBatchDeleteBtn) return;

  confirmBatchDeleteBtn.disabled = true;
  confirmBatchDeleteBtn.textContent = "正在删除...";

  try {
    const result = await api.deleteManyContent("recipe", state.pendingDeleteIds);
    closeBatchDeleteModal();
    batchManager?.setEnabled(false);
    await syncRecipeCatalog();
    renderRecipes();
    const count = result.deleted.length;
    const failCount = result.failed?.length || 0;
    window.uiToast?.show(
      failCount ? `已删除 ${count} 道，${failCount} 道失败` : `已删除 ${count} 道菜`,
      { type: failCount ? "error" : "success", duration: 1600 },
    );
  } catch (error) {
    window.uiToast?.show(error?.message || "删除失败", { type: "error", duration: 2000 });
  } finally {
    if (confirmBatchDeleteBtn) {
      confirmBatchDeleteBtn.disabled = false;
      confirmBatchDeleteBtn.textContent = "确认删除";
    }
  }
}

async function syncRecipeCatalog() {
  if (!api?.listRecipes) return;
  try {
    const remoteList = await api.listRecipes();
    if (Array.isArray(remoteList) && remoteList.length > 0) {
      api.mergeCatalogRecipes(catalog, remoteList);
    }
  } catch {
    // fall back to bundled catalog
  }
}

function bindBatchModal() {
  batchDeleteModal?.querySelectorAll("[data-close-batch-modal]").forEach((node) => {
    node.addEventListener("click", closeBatchDeleteModal);
  });
  confirmBatchDeleteBtn?.addEventListener("click", confirmBatchDelete);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && batchDeleteModal && !batchDeleteModal.hidden) {
      closeBatchDeleteModal();
    }
  });
}

categoryChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category || "all";
  renderCategoryChips();
  renderRecipes();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderRecipes();
});

async function init() {
  if (api?.getSessionStatus) {
    const session = await api.getSessionStatus();
    state.canManage = api.canEdit() && (!api.isRemoteConfigured() || session.isAdmin);
  } else {
    state.canManage = api?.canEdit?.() || false;
  }

  if (batchManager) {
    batchManager.canManage = state.canManage;
    batchManager.bind();
  }
  bindBatchModal();

  await syncRecipeCatalog();
  renderCategoryChips();
  renderRecipes();
  batchManager?.updateUI();
  searchInput.focus();
}

init();
