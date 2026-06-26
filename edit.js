const api = window.contentApi;
const catalog = window.recipeCatalog;

if (!api || !catalog) {
  throw new Error("contentApi 或 recipeCatalog 未加载，请先在 HTML 中引入 data.js 和 api-client.js");
}

const editBreadcrumb = document.getElementById("editBreadcrumb");
const editTitle = document.getElementById("editTitle");
const editDesc = document.getElementById("editDesc");
const editStatus = document.getElementById("editStatus");
const editModeHint = document.getElementById("editModeHint");
const editNotice = document.getElementById("editNotice");
const editForm = document.getElementById("editForm");
const editStickyBar = document.getElementById("editStickyBar");
const editStickyBack = document.getElementById("editStickyBack");
const editStickyStatus = document.getElementById("editStickyStatus");
const editStickySave = document.getElementById("editStickySave");
const createRecipeModal = document.getElementById("createRecipeModal");
const createRecipeSummary = document.getElementById("createRecipeSummary");
const confirmCreateRecipeBtn = document.getElementById("confirmCreateRecipeBtn");

const state = {
  type: getParam("type") || "recipe",
  isNew: getParam("new") === "1" && (getParam("type") || "recipe") === "recipe",
  id: getParam("new") === "1" ? "" : (getParam("id") || getDefaultId(getParam("type") || "recipe")),
  data: null,
  dirty: false,
  saving: false,
  generating: false,
  canEdit: false,
  aiWorkingName: "",
  aiPreferences: "",
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
  if (editStickyStatus) {
    editStickyStatus.textContent = nextDirty ? "有未保存的修改" : "已保存";
  }
}

function setNotice(message, tone = "success") {
  if (!editNotice) return;
  editNotice.textContent = message || "";
  editNotice.style.color = tone === "error" ? "var(--primary)" : "var(--success)";
}

function renderEmpty(message) {
  return `<div class="empty-state">${message}</div>`;
}

function createEmptyRecipe() {
  return {
    id: "",
    name: "",
    coverImage: "",
    desc: "",
    categories: [],
    tags: [],
    statusTags: [],
    calories: { perServing: 0, total: 0, unit: "千卡", note: "" },
    summary: [],
    meta: [],
    ingredients: [],
    ingredientNames: [],
    ingredientCount: 0,
    steps: [],
    nutrition: [],
    tips: [],
    version: 1,
    updatedAt: null,
  };
}

function renderActions() {
  const targetHref = state.isNew
    ? "./index.html"
    : state.type === "ingredient"
      ? `./ingredient.html?id=${encodeURIComponent(state.id)}`
      : `./recipe.html?id=${encodeURIComponent(state.id)}`;
  const saveLabel = state.isNew ? "创建菜谱" : "保存修改";

  if (editStickyBack) {
    editStickyBack.href = targetHref;
    editStickyBack.textContent = state.isNew ? "返回首页" : "返回详情";
  }

  if (editStickyBar) {
    editStickyBar.hidden = !state.canEdit;
  }

  if (editStickySave) {
    editStickySave.hidden = !state.canEdit;
    editStickySave.textContent = saveLabel;
    editStickySave.disabled = state.saving;
  }
}

function renderField(label, name, value, help = "", type = "text", readonly = false) {
  const readonlyAttr = readonly ? " readonly" : "";
  return `
    <label class="edit-field">
      <span>${label}</span>
      ${type === "textarea"
        ? `<textarea name="${name}" rows="4" placeholder="请输入${label}"${readonlyAttr}>${escapeAttr(value)}</textarea>`
        : `<input name="${name}" type="${type}" value="${escapeAttr(value)}" placeholder="请输入${label}"${readonlyAttr} />`}
      ${help ? `<small>${help}</small>` : ""}
    </label>
  `;
}

function renderReadonlyIdField(id) {
  return `
    <input type="hidden" name="id" value="${escapeAttr(id)}" />
    <label class="edit-field">
      <span>菜谱 ID</span>
      <input type="text" value="${escapeAttr(id)}" readonly />
      <small>由 AI 自动生成，用于链接与存储</small>
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

function renderRecipeEditor(recipe, isNew = false) {
  const hasGenerated = Boolean(recipe.id);
  editBreadcrumb.textContent = isNew ? "新建菜谱" : `编辑菜谱 / ${recipe.name}`;
  editTitle.textContent = isNew ? "新建菜谱" : `编辑菜谱：${recipe.name}`;
  editDesc.textContent = isNew
    ? "填写菜名和可选做法偏好后，点击「AI 生成菜谱」。生成完成后请检查内容，再点「创建菜谱」保存。按回车不会直接创建。"
    : "可以修改步骤、注意事项、营养数据、原材料等内容。多行字段支持按行编辑。";
  editModeHint.textContent = api.isRemoteConfigured() ? "会优先保存到后端接口" : "当前会先保存为本地草稿";

  const aiInputSection = isNew && !hasGenerated
    ? `
      <div class="edit-grid">
        ${renderField("菜名", "name", recipe.name, "例如：番茄炒蛋、少油版")}
        ${renderTextareaField("做法偏好", "preferences", state.aiPreferences || "", "可选：少油、不要放糖、一人份、快手…")}
      </div>
      <div class="edit-ai-row">
        <button type="button" class="favorite-button" id="aiGenerateButton">AI 生成菜谱</button>
        <small>AI 会自动生成正式菜名、菜谱 ID 和完整内容</small>
      </div>
    `
    : "";

  const detailSections = hasGenerated || !isNew
    ? `
    <section class="edit-section">
      <h2 class="section-title">基础信息</h2>
      <div class="edit-grid">
        ${isNew && hasGenerated ? renderReadonlyIdField(recipe.id) : ""}
        ${renderField("菜名", "name", recipe.name)}
        ${renderField("封面图", "coverImage", recipe.coverImage)}
        ${renderTextareaField("简介", "desc", recipe.desc, "支持多行描述")}
        ${renderField("分类", "categories", (recipe.categories || []).join(", "), "逗号分隔，例如：lunch,dinner")}
        ${renderField("标签", "tags", (recipe.tags || []).join(", "), "逗号分隔")}
        ${renderField("状态标签", "statusTags", (recipe.statusTags || []).join(", "), "逗号分隔")}
      </div>
      ${isNew ? `
        <div class="edit-ai-row">
          <button type="button" class="favorite-button" id="aiGenerateButton">重新 AI 生成</button>
          <small>会覆盖当前表单内容，请确认后再点</small>
        </div>
      ` : ""}
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
        ${isNew ? "" : renderField("版本", "version", recipe.version || 1, "保存时会自动递增", "number")}
        ${isNew ? "" : renderField("更新时间", "updatedAt", recipe.updatedAt || "", "保存后自动更新", "text")}
      </div>
    </section>
    `
    : `
    <div class="empty-state">填写上方菜名后点击「AI 生成菜谱」，完整表单会出现在这里。</div>
    `;

  editForm.innerHTML = isNew && !hasGenerated
    ? `
    <section class="edit-section">
      <h2 class="section-title">开始创建</h2>
      ${aiInputSection}
    </section>
    ${detailSections}
    `
    : detailSections;
  bindAiGenerateButton();
}

function bindAiGenerateButton() {
  const button = document.getElementById("aiGenerateButton");
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => {
    startAiGeneration();
  });
}

function setAiGenerating(active, label = "AI 生成菜谱") {
  const button = document.getElementById("aiGenerateButton");
  if (button) {
    button.disabled = active;
    button.textContent = label;
  }
}

async function pollAiGeneration(agentId, runId, workingName, preferences) {
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  while (state.generating) {
    const result = await api.pollRecipeGeneration(agentId, runId, workingName, preferences);
    if (result?.status === "FINISHED" && result.recipe) {
      state.data = result.recipe;
      state.aiWorkingName = workingName;
      state.aiPreferences = preferences;
      renderRecipeEditor(state.data, true);
      setDirty(true);
      setNotice(`AI 已生成「${result.recipe.name}」（ID: ${result.recipe.id}），请检查后点击「创建菜谱」保存`);
      editStatus.textContent = "AI 生成完成，待保存";
      return;
    }

    if (result?.status === "CREATING" || result?.status === "RUNNING") {
      editStatus.textContent = `AI 生成中（${result.status}）...`;
      await delay(3000);
      continue;
    }

    throw new Error(`AI 生成失败：${result?.status || "未知状态"}`);
  }
}

function formatAiError(error) {
  const message = String(error?.message || "");
  if (error?.code === "CURSOR_NOT_CONFIGURED") {
    return "服务器未配置 CURSOR_API_KEY，无法使用 AI 生成";
  }
  if (/storage mode is disabled/i.test(message)) {
    return "Cursor 账号未开启 Storage：请在 Cursor 桌面端 Settings → Privacy 中，从「Privacy Mode (Legacy)」切换为「Privacy Mode」，或在 Dashboard → Cloud Agents 中启用存储。切换后重试。";
  }
  if (/privacy mode.*legacy/i.test(message)) {
    return "当前为 Privacy Mode (Legacy)，不支持 Cloud Agents API。请在 Cursor 设置中切换为新版 Privacy Mode 后重试。";
  }
  if (/model.*not available|invalid model/i.test(message)) {
    return "当前 Cursor 账号不支持所选 AI 模型。已改为使用账号默认模型；若仍失败，请在 Cloudflare 环境变量中设置 CURSOR_MODEL_ID（可用 GET https://api.cursor.com/v1/models 查看可用 ID）。";
  }
  return message || "AI 生成失败";
}

async function startAiGeneration() {
  if (!state.isNew || state.generating || !api.startRecipeGeneration) return;

  const formData = new FormData(editForm);
  const workingName = String(
    formData.get("name") || state.aiWorkingName || state.data?.name || "",
  ).trim();
  const preferences = String(
    formData.get("preferences") ?? state.aiPreferences ?? "",
  ).trim();

  if (!workingName) {
    setNotice("请先填写菜名", "error");
    return;
  }

  if (state.data?.id) {
    const confirmed = window.confirm("重新生成会覆盖当前表单内容，确定继续吗？");
    if (!confirmed) return;
  }

  state.generating = true;
  setAiGenerating(true, "正在生成...");
  setNotice("正在启动 AI 生成，请稍候...");
  editStatus.textContent = "AI 生成中";

  try {
    const started = await api.startRecipeGeneration(workingName, preferences);
    if (!started?.agentId || !started?.runId) {
      throw new Error("服务器未返回生成任务信息");
    }
    await pollAiGeneration(
      started.agentId,
      started.runId,
      started.name || workingName,
      started.preferences ?? preferences,
    );
  } catch (error) {
    console.error(error);
    setNotice(formatAiError(error), "error");
    editStatus.textContent = "AI 生成失败";
  } finally {
    state.generating = false;
    setAiGenerating(false);
  }
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

function validateNewRecipe(payload, recipeId) {
  const errors = [];
  const id = String(recipeId || payload.id || "").trim();

  if (!id) {
    errors.push("请先点击「AI 生成菜谱」");
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push("菜谱 ID 只能使用小写英文、数字和连字符");
  }

  if (!String(payload.name || "").trim()) {
    errors.push("请填写菜名");
  }

  if (!String(payload.desc || "").trim()) {
    errors.push("请填写简介");
  }

  const hasIngredients = Array.isArray(payload.ingredients)
    && payload.ingredients.some((group) => (group.items || []).length > 0);
  if (!hasIngredients) {
    errors.push("请至少添加一组原材料");
  }

  if (!Array.isArray(payload.steps) || !payload.steps.length) {
    errors.push("请至少添加一个做法步骤");
  }

  return errors;
}

function openCreateRecipeModal(payload, recipeId) {
  if (!createRecipeModal || !createRecipeSummary) return false;

  const name = String(payload.name || recipeId || "新菜谱").trim();
  createRecipeSummary.innerHTML = `即将创建「<strong>${escapeAttr(name)}</strong>」（ID: ${escapeAttr(recipeId)}）。`;
  createRecipeModal.hidden = false;
  document.body.style.overflow = "hidden";
  confirmCreateRecipeBtn?.focus();
  return true;
}

function closeCreateRecipeModal() {
  if (!createRecipeModal) return;
  createRecipeModal.hidden = true;
  document.body.style.overflow = "";
}

function bindCreateRecipeModal() {
  if (!createRecipeModal || createRecipeModal.dataset.bound === "1") return;
  createRecipeModal.dataset.bound = "1";

  createRecipeModal.querySelectorAll("[data-close-create-modal]").forEach((node) => {
    node.addEventListener("click", closeCreateRecipeModal);
  });

  confirmCreateRecipeBtn?.addEventListener("click", async () => {
    closeCreateRecipeModal();
    await performSave();
  });
}

async function saveCurrentForm() {
  if (!state.data || !state.canEdit || state.saving) return;

  const payload = state.type === "ingredient"
    ? readIngredientForm(editForm, state.data)
    : readRecipeForm(editForm, state.data);

  if (state.isNew && state.type === "recipe") {
    const newId = new FormData(editForm).get("id")?.trim() || state.data?.id;
    const errors = validateNewRecipe(payload, newId);
    if (errors.length) {
      setNotice(errors.join("；"), "error");
      editStatus.textContent = "请先补全必填内容";
      return;
    }
    if (openCreateRecipeModal(payload, newId)) {
      return;
    }
  }

  await performSave();
}

async function performSave() {
  if (!state.data || !state.canEdit || state.saving) return;

  try {
    state.saving = true;
    setDirty(true);
    renderActions();
    editStatus.textContent = "正在保存...";
    setNotice("正在提交修改，请稍候...");

    const payload = state.type === "ingredient"
      ? readIngredientForm(editForm, state.data)
      : readRecipeForm(editForm, state.data);

    let saved;
    const wasNew = state.isNew;
    if (state.isNew) {
      const newId = new FormData(editForm).get("id")?.trim() || state.data?.id;
      if (!newId) {
        throw new Error("请先点击「AI 生成菜谱」");
      }
      saved = await api.createContent(state.type, newId, payload);
      state.isNew = false;
      state.id = saved.id;
    } else {
      saved = await api.saveContent(state.type, state.id, payload);
    }

    state.data = saved;
    const savedTo = api.getLastSaveTarget?.() || (api.isRemoteConfigured() ? 'remote' : 'local');
    const saveFailure = api.getLastSaveFailure?.() || '';
    const ingredientSync = api.getLastIngredientSync?.();
    const syncCount = ingredientSync
      ? (ingredientSync.created?.length || 0) + (ingredientSync.updated?.length || 0)
      : 0;
    const syncNote = syncCount > 0 ? `，已同步 ${syncCount} 个食材` : '';
    const successText = savedTo === 'remote'
      ? (wasNew ? `已创建并保存到后端${syncNote}` : '已保存到后端')
      : saveFailure
        ? `${wasNew ? '已创建到本机草稿' : '已保存到本机草稿'}：${saveFailure}${syncNote}`
        : (wasNew ? `已创建到本机草稿（未写入服务器，换设备会丢失）${syncNote}` : `已保存到本机草稿（未写入服务器，换设备会丢失）${syncNote}`);
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
    renderActions();
  }
}

async function load() {
  const session = await api.getSessionStatus();
  if (session.hasToken && session.checkedRemote && !session.isAdmin) {
    api.clearAdminSession();
  }
  state.canEdit = !api.isRemoteConfigured() ? true : Boolean(session.isAdmin);
  renderActions();

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
  } else if (state.isNew) {
    state.data = createEmptyRecipe();
    renderRecipeEditor(state.data, true);
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

editForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const tag = String(event.target?.tagName || "").toLowerCase();
  if (tag === "textarea") return;
  event.preventDefault();
});

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
bindCreateRecipeModal();
