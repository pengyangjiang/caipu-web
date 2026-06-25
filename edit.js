const api = window.contentApi;
const catalog = window.recipeCatalog;

if (!api || !catalog) {
  throw new Error("contentApi 或 recipeCatalog 未加载，请先在 HTML 中引入 data.js 和 api-client.js");
}

const editBreadcrumb = document.getElementById("editBreadcrumb");
const editHeaderActions = document.getElementById("editHeaderActions");
const editTitle = document.getElementById("editTitle");
const editDesc = document.getElementById("editDesc");
const editStatus = document.getElementById("editStatus");
const editModeHint = document.getElementById("editModeHint");
const editNotice = document.getElementById("editNotice");
const editForm = document.getElementById("editForm");

const state = {
  type: getParam("type") || "recipe",
  id: getParam("id") || getDefaultId(getParam("type") || "recipe"),
  data: null,
  dirty: false,
  saving: false,
  canEdit: false,
};

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getDefaultId(type) {
  if (type === "ingredient") {
    return Object.keys(window.ingredientDetails || {})[0] || "";
  }
  return catalog.defaultRecipeId;
}

function getRecipeIndex(id) {
  return catalog.recipes.findIndex((recipe) => recipe.id === id);
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function setDirty(nextDirty = true) {
  state.dirty = nextDirty;
  editStatus.textContent = nextDirty ? "有未保存的修改" : "已保存";
}

function setNotice(message, tone = "success") {
  if (!editNotice) return;
  editNotice.textContent = message || "";
  editNotice.style.color = tone === "error" ? "var(--primary)" : "var(--success)";
}

function renderEmpty(message) {
  return `<div class="empty-state">${message}</div>`;
}

function renderActions() {
  const targetHref = state.type === "ingredient"
    ? `./ingredient.html?id=${encodeURIComponent(state.id)}`
    : `./recipe.html?id=${encodeURIComponent(state.id)}`;
  const loginHref = `./login.html?returnTo=${encodeURIComponent(window.location.href)}`;

  editHeaderActions.innerHTML = `
    <a class="action-link" href="${targetHref}">返回详情</a>
    ${state.canEdit ? `<button class="favorite-button is-active" type="submit" form="editForm">保存修改</button>` : ""}
    ${state.canEdit ? `<button class="action-link" type="button" id="logoutButton">退出登录</button>` : `<a class="action-link" href="${loginHref}">管理员登录</a>`}
  `;
}

function renderField(label, name, value, help = "", type = "text") {
  return `
    <label class="edit-field">
      <span>${label}</span>
      ${type === "textarea"
        ? `<textarea name="${name}" rows="4" placeholder="请输入${label}">${escapeAttr(value)}</textarea>`
        : `<input name="${name}" type="${type}" value="${escapeAttr(value)}" placeholder="请输入${label}" />`}
      ${help ? `<small>${help}</small>` : ""}
    </label>
  `;
}

function renderTextareaField(label, name, value, help = "") {
  return renderField(label, name, value, help, "textarea");
}

function stringifyLines(items, mapper) {
  return (items || []).map(mapper).join("\n");
}

function serializeRecipeIngredients(groups) {
  return stringifyLines(groups, (group) => {
    const items = (group.items || []).map((item) => `${item.name}|${item.amount}`).join(";");
    return `${group.group}:${items}`;
  });
}

function parseRecipeIngredients(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [groupName, rawItems = ""] = line.split(":");
      return {
        group: groupName.trim(),
        items: rawItems
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const [name = "", amount = ""] = item.split("|");
            return { name: name.trim(), amount: amount.trim() };
          }),
      };
    })
    .filter((group) => group.group && group.items.length > 0);
}

function serializeSteps(steps) {
  return stringifyLines(steps, (step) => `${step.title}|${step.content}|${step.time}`);
}

function parseSteps(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = "", content = "", time = ""] = line.split("|");
      return { title: title.trim(), content: content.trim(), time: time.trim() };
    })
    .filter((step) => step.title && step.content);
}

function serializeKeyValueRows(rows) {
  return stringifyLines(rows, (row) => `${row.label}|${row.value}${row.unit ? `|${row.unit}` : ""}`);
}

function parseKeyValueRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label = "", value = "", unit = ""] = line.split("|");
      return { label: label.trim(), value: value.trim(), unit: unit.trim() };
    })
    .filter((row) => row.label && row.value);
}

function serializeTextRows(rows) {
  return stringifyLines(rows, (row) => `${row.title}|${row.content}`);
}

function parseTextRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = "", content = ""] = line.split("|");
      return { title: title.trim(), content: content.trim() };
    })
    .filter((row) => row.title && row.content);
}

function renderRecipeEditor(recipe) {
  editBreadcrumb.textContent = `编辑菜谱 / ${recipe.name}`;
  editTitle.textContent = `编辑菜谱：${recipe.name}`;
  editDesc.textContent = "可以修改步骤、注意事项、营养数据、原材料等内容。多行字段支持按行编辑。";
  editModeHint.textContent = api.isRemoteConfigured() ? "会优先保存到后端接口" : "当前会先保存为本地草稿";

  editForm.innerHTML = `
    <section class="edit-section">
      <h2 class="section-title">基础信息</h2>
      <div class="edit-grid">
        ${renderField("菜名", "name", recipe.name)}
        ${renderField("封面图", "coverImage", recipe.coverImage)}
        ${renderTextareaField("简介", "desc", recipe.desc, "支持多行描述")}
        ${renderField("分类", "categories", (recipe.categories || []).join(", "), "逗号分隔，例如：lunch,dinner")}
        ${renderField("标签", "tags", (recipe.tags || []).join(", "), "逗号分隔")}
        ${renderField("状态标签", "statusTags", (recipe.statusTags || []).join(", "), "逗号分隔")}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">热量与营养</h2>
      <div class="edit-grid">
        ${renderField("每份热量", "calories.perServing", recipe.calories?.perServing ?? "", "数字")}
        ${renderField("总热量", "calories.total", recipe.calories?.total ?? "", "数字")}
        ${renderField("热量单位", "calories.unit", recipe.calories?.unit ?? "千卡")}
        ${renderTextareaField("热量说明", "calories.note", recipe.calories?.note ?? "")}
        ${renderTextareaField("摘要卡片", "summary", serializeKeyValueRows(recipe.summary || []), "每行一个：标签|值")}
        ${renderTextareaField("营养信息", "nutrition", serializeKeyValueRows(recipe.nutrition || []), "每行一个：标签|值|单位")}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">原材料</h2>
      <label class="edit-field">
        <span>原材料分组</span>
        <textarea name="ingredients" rows="8" placeholder="主料:鸡胸肉|180g;生菜|80g\n辅料:黄瓜|1/2 根;玉米粒|30g">${escapeAttr(serializeRecipeIngredients(recipe.ingredients || []))}</textarea>
        <small>格式：分组名:食材|用量;食材|用量。每行一个分组。</small>
      </label>
    </section>

    <section class="edit-section">
      <h2 class="section-title">步骤与小贴士</h2>
      <div class="edit-grid">
        ${renderTextareaField("做法步骤", "steps", serializeSteps(recipe.steps || []), "每行一个：标题|内容|建议用时")}
        ${renderTextareaField("小贴士", "tips", serializeTextRows(recipe.tips || []), "每行一个：标题|内容")}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">版本信息</h2>
      <div class="edit-grid">
        ${renderField("版本", "version", recipe.version || 1, "保存时会自动递增", "number")}
        ${renderField("更新时间", "updatedAt", recipe.updatedAt || "", "保存后自动更新", "text")}
      </div>
    </section>
  `;
}

function renderIngredientEditor(ingredient) {
  editBreadcrumb.textContent = `编辑食材 / ${ingredient.name}`;
  editTitle.textContent = `编辑食材：${ingredient.name}`;
  editDesc.textContent = "可以修改热量、营养值、别名和处理要点。";
  editModeHint.textContent = api.isRemoteConfigured() ? "会优先保存到后端接口" : "当前会先保存为本地草稿";

  editForm.innerHTML = `
    <section class="edit-section">
      <h2 class="section-title">基础信息</h2>
      <div class="edit-grid">
        ${renderField("食材名", "name", ingredient.name)}
        ${renderField("别名", "aliases", (ingredient.aliases || []).join(", "), "逗号分隔")}
        ${renderField("分类", "category", ingredient.category)}
        ${renderField("单位", "unit", ingredient.unit)}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">热量与营养</h2>
      <div class="edit-grid">
        ${renderField("每100g热量", "caloriesPer100g", ingredient.caloriesPer100g ?? "", "数字", "number")}
        ${renderField("蛋白质", "nutritionPer100g.protein", ingredient.nutritionPer100g?.protein ?? "", "每100g", "number")}
        ${renderField("脂肪", "nutritionPer100g.fat", ingredient.nutritionPer100g?.fat ?? "", "每100g", "number")}
        ${renderField("碳水", "nutritionPer100g.carbs", ingredient.nutritionPer100g?.carbs ?? "", "每100g", "number")}
        ${renderField("膳食纤维", "nutritionPer100g.fiber", ingredient.nutritionPer100g?.fiber ?? "", "每100g", "number")}
        ${renderField("版本", "version", ingredient.version || 1, "保存时会自动递增", "number")}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">处理要点</h2>
      <div class="edit-grid">
        ${renderTextareaField("处理要点", "handlingTips", (ingredient.handlingTips || []).join("\n"), "每行一条")}
        ${renderTextareaField("保存建议", "storageTips", (ingredient.storageTips || []).join("\n"), "每行一条")}
        ${renderTextareaField("烹饪建议", "cookingNotes", (ingredient.cookingNotes || []).join("\n"), "每行一条")}
      </div>
    </section>

    <section class="edit-section">
      <h2 class="section-title">版本信息</h2>
      <div class="edit-grid">
        ${renderField("更新时间", "updatedAt", ingredient.updatedAt || "", "保存后自动更新", "text")}
      </div>
    </section>
  `;
}

function readRecipeForm(form, source) {
  const data = new FormData(form);
  const ingredients = parseRecipeIngredients(data.get("ingredients"));
  const steps = parseSteps(data.get("steps"));
  const tips = parseTextRows(data.get("tips")).map((item) => ({ title: item.title, content: item.content }));
  const summary = parseKeyValueRows(data.get("summary")).map((item) => ({ label: item.label, value: item.value }));
  const nutrition = parseKeyValueRows(data.get("nutrition")).map((item) => ({ label: item.label, value: item.value, unit: item.unit || "g / 份" }));

  return {
    ...source,
    name: data.get("name")?.trim(),
    coverImage: data.get("coverImage")?.trim(),
    desc: data.get("desc")?.trim(),
    categories: String(data.get("categories") || "").split(",").map((item) => item.trim()).filter(Boolean),
    tags: String(data.get("tags") || "").split(",").map((item) => item.trim()).filter(Boolean),
    statusTags: String(data.get("statusTags") || "").split(",").map((item) => item.trim()).filter(Boolean),
    calories: {
      perServing: Number(data.get("calories.perServing") || 0),
      total: Number(data.get("calories.total") || 0),
      unit: data.get("calories.unit")?.trim() || "千卡",
      note: data.get("calories.note")?.trim() || "",
    },
    summary,
    ingredients,
    ingredientNames: ingredients.flatMap((group) => group.items.map((item) => item.name)),
    ingredientCount: ingredients.flatMap((group) => group.items).length,
    steps,
    nutrition,
    tips,
  };
}

function readIngredientForm(form, source) {
  const data = new FormData(form);
  return {
    ...source,
    name: data.get("name")?.trim(),
    aliases: String(data.get("aliases") || "").split(",").map((item) => item.trim()).filter(Boolean),
    category: data.get("category")?.trim(),
    unit: data.get("unit")?.trim(),
    caloriesPer100g: Number(data.get("caloriesPer100g") || 0),
    nutritionPer100g: {
      protein: Number(data.get("nutritionPer100g.protein") || 0),
      fat: Number(data.get("nutritionPer100g.fat") || 0),
      carbs: Number(data.get("nutritionPer100g.carbs") || 0),
      fiber: Number(data.get("nutritionPer100g.fiber") || 0),
    },
    handlingTips: String(data.get("handlingTips") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    storageTips: String(data.get("storageTips") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    cookingNotes: String(data.get("cookingNotes") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
  };
}

async function saveCurrentForm() {
  if (!state.data || !state.canEdit || state.saving) return;

  try {
    state.saving = true;
    setDirty(true);
    editStatus.textContent = "正在保存...";
    setNotice("正在提交修改，请稍候...");

    const payload = state.type === "ingredient"
      ? readIngredientForm(editForm, state.data)
      : readRecipeForm(editForm, state.data);

    const saved = await api.saveContent(state.type, state.id, payload);
    state.data = saved;
    const savedTo = api.getLastSaveTarget?.() || (api.isRemoteConfigured() ? 'remote' : 'local');
    const saveFailure = api.getLastSaveFailure?.() || '';
    const successText = savedTo === 'remote'
      ? '已保存到后端'
      : saveFailure
        ? `已保存到本机草稿：${saveFailure}`
        : '已保存到本机草稿（未写入服务器，换设备会丢失）';
    editStatus.textContent = successText;
    setNotice(`${successText}，正在返回详情页...`);
    setDirty(false);

    const target = state.type === "ingredient"
      ? `./ingredient.html?id=${encodeURIComponent(state.id)}`
      : `./recipe.html?id=${encodeURIComponent(state.id)}`;
    window.setTimeout(() => {
      window.location.href = target;
    }, 650);
  } catch (error) {
    console.error(error);
    editStatus.textContent = "保存失败，请重试";
    setNotice(error?.message || "保存失败，请重试", "error");
  } finally {
    state.saving = false;
  }
}

async function load() {
  const session = await api.getSessionStatus();
  if (session.hasToken && session.checkedRemote && !session.isAdmin) {
    api.clearAdminSession();
  }
  state.canEdit = !api.isRemoteConfigured() ? true : Boolean(session.isAdmin);
  renderActions();

  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      if (api.clearAdminSession) {
        api.clearAdminSession();
      }
      window.location.reload();
    });
  }

  if (!state.canEdit) {
    editTitle.textContent = "当前账号无编辑权限";
    editDesc.textContent = "只有管理员可以进入编辑页并保存修改。";
    editStatus.textContent = "只读模式";
    editModeHint.textContent = api.isRemoteConfigured() ? "请登录管理员账号后再编辑" : "本地演示默认可编辑，如需限制可设置管理员标记";
    setNotice("你可以先登录，再回到这里继续编辑。");
    editForm.innerHTML = `${renderEmpty("当前没有编辑权限。")}<div style=\"margin-top:12px;\"> <a class=\"action-link\" href=\"./login.html?returnTo=${encodeURIComponent(window.location.href)}\">去登录</a> </div>`;
    return;
  }

  if (state.type === "ingredient") {
    const ingredient = await api.loadContent("ingredient", state.id);
    state.data = ingredient;
    if (!ingredient) {
      editTitle.textContent = "没有找到对应的食材";
      editDesc.textContent = "请检查链接中的 id 是否正确。";
      editForm.innerHTML = renderEmpty("没有找到对应的食材。");
      return;
    }
    renderIngredientEditor(ingredient);
  } else {
    const recipe = await api.loadContent("recipe", state.id);
    state.data = recipe;
    if (!recipe) {
      editTitle.textContent = "没有找到对应的菜谱";
      editDesc.textContent = "请检查链接中的 id 是否正确。";
      editForm.innerHTML = renderEmpty("没有找到对应的菜谱。");
      return;
    }
    renderRecipeEditor(recipe);
  }

  setDirty(false);
}

window.addEventListener("beforeunload", (event) => {
  if (!state.canEdit || state.saving || !state.dirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

editForm.addEventListener("input", () => setDirty(true));

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveCurrentForm();
});

window.addEventListener("keydown", (event) => {
  const key = String(event.key || "").toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "s") {
    event.preventDefault();
    saveCurrentForm();
  }
});

load();
