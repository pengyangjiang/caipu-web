const SHOPPING_LIST_KEY = "recipe-shopping-list";

const summaryRoot = document.getElementById("shoppingSummary");
const listRoot = document.getElementById("shoppingList");
const form = document.getElementById("shoppingForm");
const nameInput = document.getElementById("shoppingName");
const amountInput = document.getElementById("shoppingAmount");
const clearPurchasedBtn = document.getElementById("clearPurchasedBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

if (!summaryRoot || !listRoot || !form || !nameInput || !amountInput || !clearPurchasedBtn || !clearAllBtn) {
  throw new Error("购物清单页面初始化失败，请检查 shopping.html 中的元素是否完整。");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
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

function normalizeName(value) {
  return String(value || "").toLowerCase().trim();
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

function mergeUniqueValues(current, incoming) {
  const values = new Set((current || []).filter(Boolean));
  (incoming || []).forEach((value) => {
    const text = String(value || "").trim();
    if (text) values.add(text);
  });
  return [...values];
}

function getPrimarySourceLabel(item) {
  const source = String(item.sources?.[0] || "").trim();
  return source || "手动添加";
}

function groupShoppingList(list) {
  const groups = new Map();

  list.forEach((item) => {
    const groupLabel = getPrimarySourceLabel(item);
    if (!groups.has(groupLabel)) {
      groups.set(groupLabel, []);
    }
    groups.get(groupLabel).push(item);
  });

  return [...groups.entries()].map(([label, items]) => ({
    label,
    items,
    total: items.length,
    checked: items.filter((item) => item.checked).length,
  }));
}

function addShoppingItem(name, amount = "", source = "手动添加") {
  const itemName = String(name || "").trim();
  if (!itemName) return false;

  const id = normalizeName(itemName);
  const now = new Date().toISOString();
  const list = getShoppingList();
  const existingIndex = list.findIndex((item) => item.id === id);
  const nextAmount = String(amount || "").trim();
  const nextSource = String(source || "").trim();

  if (existingIndex < 0) {
    list.unshift({
      id,
      name: itemName,
      amounts: nextAmount ? [nextAmount] : [],
      sources: nextSource ? [nextSource] : [],
      checked: false,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const current = list[existingIndex];
    list[existingIndex] = {
      ...current,
      name: itemName,
      amounts: mergeUniqueValues(current.amounts, nextAmount ? [nextAmount] : []),
      sources: mergeUniqueValues(current.sources, nextSource ? [nextSource] : []),
      checked: false,
      updatedAt: now,
    };
  }

  saveShoppingList(list);
  return true;
}

function toggleShoppingItem(id, checked) {
  const list = getShoppingList();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;

  list[index] = {
    ...list[index],
    checked: Boolean(checked),
    updatedAt: new Date().toISOString(),
  };
  saveShoppingList(list);
}

function removeShoppingItem(id) {
  const list = getShoppingList().filter((item) => item.id !== id);
  saveShoppingList(list);
}

function clearPurchasedItems() {
  saveShoppingList(getShoppingList().filter((item) => !item.checked));
}

function clearAllItems() {
  saveShoppingList([]);
}

function renderSummary(list) {
  const total = list.length;
  const checked = list.filter((item) => item.checked).length;
  const pending = Math.max(0, total - checked);
  const groups = groupShoppingList(list).length;

  summaryRoot.innerHTML = `
    <article class="shopping-stat-card">
      <span class="shopping-stat-label">总条目</span>
      <strong class="shopping-stat-value">${total}</strong>
    </article>
    <article class="shopping-stat-card">
      <span class="shopping-stat-label">已勾选</span>
      <strong class="shopping-stat-value">${checked}</strong>
    </article>
    <article class="shopping-stat-card">
      <span class="shopping-stat-label">待购买</span>
      <strong class="shopping-stat-value">${pending}</strong>
    </article>
    <article class="shopping-stat-card">
      <span class="shopping-stat-label">分组</span>
      <strong class="shopping-stat-value">${groups}</strong>
    </article>
  `;
}

function renderItem(item) {
  const amountText = item.amounts?.length ? item.amounts.join(" / ") : "未填写数量";
  const sourceText = item.sources?.length ? `来源：${item.sources.join("、")}` : "来源：手动添加";

  return `
    <article class="shopping-item ${item.checked ? "is-checked" : ""}">
      <label class="shopping-item-toggle">
        <input type="checkbox" data-shopping-toggle="${escapeHtml(item.id)}" ${item.checked ? "checked" : ""} />
        <span>已买到</span>
      </label>
      <div class="shopping-item-body">
        <div class="shopping-item-head">
          <h3 class="shopping-item-title">${escapeHtml(item.name)}</h3>
          <button class="shopping-item-remove" type="button" data-shopping-remove="${escapeHtml(item.id)}">删除</button>
        </div>
        <p class="shopping-item-amount">${escapeHtml(amountText)}</p>
        <p class="shopping-item-meta">${escapeHtml(sourceText)}</p>
      </div>
    </article>
  `;
}

function renderList(list) {
  if (!list.length) {
    listRoot.innerHTML = `
      <div class="empty-state">
        购物清单还是空的。你可以从菜谱详情页把原材料一键加进来，也可以手动补充。
      </div>
    `;
    return;
  }

  const groups = groupShoppingList(list);

  listRoot.innerHTML = `
    <div class="shopping-groups">
      ${groups
        .map(
          (group) => `
            <section class="shopping-group">
              <div class="shopping-group-head">
                <div>
                  <h3 class="shopping-group-title">${escapeHtml(group.label)}</h3>
                  <p class="shopping-group-note">${group.checked}/${group.total} 项已勾选</p>
                </div>
                <span class="shopping-group-badge">${group.total} 项</span>
              </div>
              <div class="shopping-list">
                ${group.items.map(renderItem).join("")}
              </div>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function render() {
  const list = getShoppingList();
  renderSummary(list);
  renderList(list);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const added = addShoppingItem(nameInput.value, amountInput.value);
  if (!added) return;

  form.reset();
  nameInput.focus();
  render();
  window.uiToast?.show("已添加到购物清单", { type: "success", duration: 1000 });
});

listRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const id = target.dataset.shoppingToggle;
  if (!id) return;

  toggleShoppingItem(id, target.checked);
  render();
});

listRoot.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeId = target.dataset.shoppingRemove;
  if (!removeId) return;

  removeShoppingItem(removeId);
  render();
  window.uiToast?.show("已删除该条目", { type: "success", duration: 1000 });
});

clearPurchasedBtn.addEventListener("click", () => {
  clearPurchasedItems();
  render();
  window.uiToast?.show("已清空已购条目", { type: "success", duration: 1000 });
});

clearAllBtn.addEventListener("click", () => {
  if (!window.confirm("确认清空整个购物清单吗？")) return;
  clearAllItems();
  render();
  window.uiToast?.show("购物清单已清空", { type: "success", duration: 1000 });
});

render();
