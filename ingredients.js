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
};

const searchInput = document.getElementById("ingredientsSearch");
const categoryChips = document.getElementById("ingredientsCategoryChips");
const ingredientsMeta = document.getElementById("ingredientsMeta");
const ingredientsSections = document.getElementById("ingredientsSections");

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

  return `
    <li class="ingredient-row">
      <a class="ingredient-row-main" href="./ingredient.html?id=${encodeURIComponent(ingredient.id)}">
        <span class="ingredient-row-name">${escapeHtml(ingredient.name)}</span>
        <span class="ingredient-row-aliases">别名：${escapeHtml(aliasText)}</span>
      </a>
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
  api.mergeCatalogIngredients?.(catalog, []);
  await syncIngredientCatalog();
  renderCategoryChips();
  renderIngredients();
  searchInput.focus();
}

init();
