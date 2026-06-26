(function () {
  const NAV_ITEMS = [
    { id: "recipes", href: "./recipes.html", label: "全部菜品" },
    { id: "ingredients", href: "./ingredients.html", label: "全部食材" },
    { id: "shopping", href: "./shopping.html", label: "购物清单" },
  ];

  function getCurrentNavId() {
    const path = window.location.pathname.split("/").pop() || "index.html";
    if (path === "recipes.html") return "recipes";
    if (path === "ingredients.html") return "ingredients";
    if (path === "shopping.html") return "shopping";
    return null;
  }

  function getLoginHref() {
    return `./login.html?returnTo=${encodeURIComponent(window.location.href)}`;
  }

  function renderNavLinks(activeId) {
    return NAV_ITEMS.map((item) => {
      const active = item.id === activeId ? ' aria-current="page"' : "";
      const className = item.id === activeId ? "site-nav-link is-active" : "site-nav-link";
      return `<a class="${className}" href="${item.href}"${active}>${item.label}</a>`;
    }).join("");
  }

  function renderNavMarkup(activeId) {
    return `
      <a class="site-brand" href="./index.html">
        <img class="site-brand-icon" src="./favicon.svg" width="22" height="22" alt="" />
        <span>菜谱图谱</span>
      </a>
      <nav class="site-nav-links" aria-label="站点导航">
        ${renderNavLinks(activeId)}
      </nav>
      <details class="admin-menu" id="adminMenu">
        <summary class="admin-menu-trigger">管理员</summary>
        <div class="admin-menu-panel">
          <p class="admin-menu-status" id="adminStatus">正在检查登录状态...</p>
          <a class="admin-menu-item" href="${getLoginHref()}" id="adminLoginLink">登录</a>
          <a class="admin-menu-item" href="./edit.html?type=recipe&new=1" id="newRecipeLink" hidden>新建菜谱</a>
          <button class="admin-menu-item" type="button" id="adminLogoutBtn" hidden>退出登录</button>
        </div>
      </details>
    `;
  }

  function bindAdminLogout() {
    const adminLogoutBtn = document.getElementById("adminLogoutBtn");
    if (!adminLogoutBtn || adminLogoutBtn.dataset.bound === "1") return;
    adminLogoutBtn.dataset.bound = "1";
    adminLogoutBtn.addEventListener("click", () => {
      window.contentApi?.clearAdminSession?.();
      const adminMenu = document.getElementById("adminMenu");
      if (adminMenu) adminMenu.open = false;
      refreshAdminStatus();
    });
  }

  async function refreshAdminStatus() {
    const adminStatus = document.getElementById("adminStatus");
    const adminLoginLink = document.getElementById("adminLoginLink");
    const adminLogoutBtn = document.getElementById("adminLogoutBtn");
    const newRecipeLink = document.getElementById("newRecipeLink");
    const api = window.contentApi;

    if (!adminStatus || !api) return;

    const session = await api.getSessionStatus();
    if (session.hasToken && session.checkedRemote && !session.isAdmin) {
      api.clearAdminSession();
      return refreshAdminStatus();
    }

    if (session.isAdmin || (session.hasToken && api.canEdit())) {
      adminStatus.textContent = session.checkedRemote ? "当前已登录管理员" : "已保存登录信息";
      if (adminLoginLink) adminLoginLink.hidden = true;
      if (adminLogoutBtn) adminLogoutBtn.hidden = false;
      if (newRecipeLink) newRecipeLink.hidden = false;
      return;
    }

    adminStatus.textContent = session.hasToken
      ? "已保存登录信息，待验证"
      : "未登录，登录后可编辑内容";
    if (adminLoginLink) {
      adminLoginLink.hidden = false;
      adminLoginLink.href = getLoginHref();
    }
    if (adminLogoutBtn) adminLogoutBtn.hidden = true;
    if (newRecipeLink) newRecipeLink.hidden = true;
  }

  function init(options = {}) {
    const mount = document.getElementById("siteNav");
    if (!mount) return null;

    const activeId = options.activeId ?? getCurrentNavId();
    mount.className = "site-nav";
    mount.innerHTML = renderNavMarkup(activeId);
    bindAdminLogout();
    refreshAdminStatus();
    return mount;
  }

  window.siteNav = {
    init,
    refreshAdminStatus,
    getCurrentNavId,
  };

  if (document.getElementById("siteNav")) {
    init();
  }
})();
