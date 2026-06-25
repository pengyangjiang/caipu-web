(() => {
  const TOAST_CONTAINER_ID = "uiToastContainer";

  function ensureContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) return container;

    container = document.createElement("div");
    container.id = TOAST_CONTAINER_ID;
    container.className = "ui-toast-container";
    document.body.appendChild(container);
    return container;
  }

  function show(message, options = {}) {
    const text = String(message || "").trim();
    if (!text) return;

    const container = ensureContainer();
    const toast = document.createElement("div");
    toast.className = `ui-toast ${options.type ? `is-${options.type}` : ""}`.trim();
    toast.textContent = text;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => {
        toast.remove();
        if (!container.childElementCount) {
          container.remove();
        }
      }, 180);
    }, Math.max(300, Number(options.duration) || 1000));
  }

  window.uiToast = { show };
})();
