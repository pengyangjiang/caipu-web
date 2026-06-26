const catalog = window.recipeCatalog;
const api = window.contentApi;
const ingredientCategories = window.ingredientSync?.INGREDIENT_CATEGORIES || [
  "蛋白质",
  "蔬菜",
  "主食",
  "调味料",
  "乳制品",
  "油脂",
  "香辛料",
  "其他",
];

if (!catalog) {
  throw new Error("recipeCatalog 未加载，请先在 HTML 中引入 data.js");
}

const state = {
  query: "",
  category: "all",
  canManage: false,
  pendingDeleteIds: [],
};

const searchInput = document.getElementById("ingredientsSearch");
const categoryChips = document.getElementById("ingredientsCategoryChips");
const ingredientsMeta = document.getElementById("ingredientsMeta");
const ingredientsSections = document.getElementById("ingredientsSections");
const batchDeleteModal = document.getElementById("batchDeleteModal");
const batchDeleteDesc = document.getElementById("batchDeleteDesc");
const batchDeleteHint = document.getElementById("batchDeleteHint");
const confirmBatchDeleteBtn = document.getElementById("confirmBatchDeleteBtn");

const batchManager = window.listBatchUi?.createBatchManager({
  root: ingredientsSections,
  shellSelector: ".ingredients-shell",
  itemUnit: "种",
  barId: "ingredientsBatchBar",
  toolbarId: "ingredientsBatchToolbar",
  toggleBtnId: "ingredientsBatchToggleBtn",
  selectAllId: "ingredientsSelectAll",
  countId: "ingredientsBatchCount",
  deleteBtnId: "ingredientsBatchDeleteBtn",
  canManage: false,
  onDelete: (ids) => openBatchDeleteModal(ids),
});

document.title = "全部食材";

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

function getAllIngredients() {
  return catalog.ingredients || [];
}

function getIngredientSearchText(ingredient) {
  return normalizeText([
    ingredient.name,
    (ingredient.aliases || []).join(" "),
    ingredient.category,
  ].join(" "));
}

function filterIngredients() {
  const tokens = normalizeText(state.query).split(" ").filter(Boolean);

  return getAllIngredients()
    .filter((ingredient) => {
      if (state.category !== "all" && ingredient.category !== state.category) {
        return false;
      }
      if (!tokens.length) return true;
      const haystack = getIngredientSearchText(ingredient);
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
}

function renderCategoryChips() {
  const categories = [
    { id: "all", label: "全部" },
    ...ingredientCategories.map((label) => ({ id: label, label })),
  ];

  categoryChips.innerHTML = renderList(
    categories,
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

function renderIngredientRow(ingredient) {
  const aliases = (ingredient.aliases || []).filter((item) => item && item !== ingredient.name);
  const aliasText = aliases.length ? aliases.slice(0, 3).join("、") : "—";
  const calories = Number(ingredient.caloriesPer100g || 0);
  const caloriesText = calories > 0 ? `${calories} kcal / 100g` : "热量待补充";
  const checkbox = state.canManage
    ? `
      <label class="list-batch-check" aria-label="选择 ${escapeAttr(ingredient.name)}">
        <input type="checkbox" data-batch-checkbox data-batch-id="${escapeAttr(ingredient.id)}" />
      </label>
    `
    : "";

  return `
    <li class="ingredient-row" data-batch-item data-batch-id="${escapeAttr(ingredient.id)}">
      <div class="ingredient-row-leading">
        ${checkbox}
        <a class="ingredient-row-main" href="./ingredient.html?id=${encodeURIComponent(ingredient.id)}">
          <span class="ingredient-row-name">${escapeHtml(ingredient.name)}</span>
          <span class="ingredient-row-aliases">别名：${escapeHtml(aliasText)}</span>
        </a>
      </div>
      <span class="ingredient-row-meta">${escapeHtml(caloriesText)}</span>
    </li>
  `;
}

function groupByCategory(items) {
  const groups = new Map();
  for (const category of ingredientCategories) {
    groups.set(category, []);
  }
  groups.set("其他", groups.get("其他") || []);

  for (const item of items) {
    const category = ingredientCategories.includes(item.category) ? item.category : "其他";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(item);
  }

  return [...groups.entries()].filter(([, list]) => list.length > 0);
}

function renderIngredients() {
  const ingredients = filterIngredients();
  const total = getAllIngredients().length;
  const categoryLabel = state.category === "all" ? "全部" : state.category;

  ingredientsMeta.textContent = state.category === "all"
    ? `共 ${total} 种食材，当前显示 ${ingredients.length} 种`
    : `${categoryLabel} · 共 ${ingredients.length} 种（全部 ${total} 种）`;

  if (!ingredients.length) {
    ingredientsSections.innerHTML = renderEmpty("没有找到匹配的食材，试试换个关键词或分类。");
    batchManager?.updateUI();
    return;
  }

  const groups = state.category === "all"
    ? groupByCategory(ingredients)
    : [[state.category, ingredients]];

  ingredientsSections.innerHTML = renderList(
    groups,
    ([category, items]) => `
      <section class="ingredients-section">
        <h2 class="ingredients-section-title">${escapeHtml(category)}</h2>
        <ul class="ingredients-list">
          ${renderList(items, renderIngredientRow)}
        </ul>
      </section>
    `,
  );

  batchManager?.updateUI();
}

function getIngredientNameById(id) {
  return getAllIngredients().find((item) => item.id === id)?.name || id;
}

function openBatchDeleteModal(ids) {
  if (!batchDeleteModal || !ids.length) return;
  state.pendingDeleteIds = ids;
  const names = ids.slice(0, 5).map(getIngredientNameById);
  const more = ids.length > 5 ? `等 ${ids.length} 种食材` : "";
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
    const result = await api.deleteManyContent("ingredient", state.pendingDeleteIds);
    closeBatchDeleteModal();
    batchManager?.setEnabled(false);
    await syncIngredientCatalog();
    renderIngredients();
    const count = result.deleted.length;
    const failCount = result.failed?.length || 0;
    window.uiToast?.show(
      failCount ? `已删除 ${count} 种，${failCount} 种失败` : `已删除 ${count} 种食材`,
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

async function syncIngredientCatalog() {
  if (!api?.listIngredients) return;
  try {
    const remoteList = await api.listIngredients();
    if (Array.isArray(remoteList)) {
      api.mergeCatalogIngredients(catalog, remoteList);
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
  renderIngredients();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderIngredients();
});

async function init() {
  if (api?.canBatchManage) {
    state.canManage = await api.canBatchManage();
  } else if (api?.getSessionStatus) {
    const session = await api.getSessionStatus();
    state.canManage = Boolean(session.hasToken && session.isAdmin);
  } else {
    state.canManage = false;
  }

  if (batchManager) {
    batchManager.canManage = state.canManage;
    if (!state.canManage) batchManager.setEnabled(false);
    batchManager.bind();
  }
  bindBatchModal();

  api.mergeCatalogIngredients?.(catalog, []);
  await syncIngredientCatalog();
  renderCategoryChips();
  renderIngredients();
  batchManager?.updateUI();
  searchInput.focus();
}

init();
