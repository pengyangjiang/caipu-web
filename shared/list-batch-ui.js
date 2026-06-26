(function () {
  function createBatchManager(options) {
    const {
      root,
      shellSelector,
      itemUnit = '项',
      onDelete,
    } = options;

    const state = {
      enabled: false,
      selected: new Set(),
    };

    const manager = {
      canManage: Boolean(options.canManage),
      state,
      setEnabled,
      updateUI,
      bind,
    };

    function getShell() {
      return shellSelector ? document.querySelector(shellSelector) : null;
    }

    function getVisibleCheckboxes() {
      return root ? [...root.querySelectorAll('[data-batch-checkbox]')] : [];
    }

    function syncSelectionFromDom() {
      getVisibleCheckboxes().forEach((checkbox) => {
        const id = checkbox.dataset.batchId;
        if (!id) return;
        checkbox.checked = state.selected.has(id);
        checkbox.closest('[data-batch-item]')?.classList.toggle('is-batch-selected', checkbox.checked);
      });
    }

    function updateUI() {
      const checkboxes = getVisibleCheckboxes();
      const visibleIds = checkboxes.map((el) => el.dataset.batchId).filter(Boolean);
      const selectedVisible = visibleIds.filter((id) => state.selected.has(id));

      syncSelectionFromDom();

      const selectAll = document.getElementById(options.selectAllId);
      if (selectAll) {
        selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
        selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
      }

      const countEl = document.getElementById(options.countId);
      if (countEl) {
        countEl.textContent = `已选 ${state.selected.size} ${itemUnit}`;
      }

      const deleteBtn = document.getElementById(options.deleteBtnId);
      if (deleteBtn) {
        deleteBtn.disabled = state.selected.size === 0;
      }

      const bar = document.getElementById(options.barId);
      if (bar) {
        bar.hidden = !state.enabled || !manager.canManage;
      }

      const toggleBtn = document.getElementById(options.toggleBtnId);
      if (toggleBtn) {
        toggleBtn.hidden = !manager.canManage;
        toggleBtn.textContent = state.enabled ? '退出批量' : '批量管理';
        toggleBtn.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
      }

      getShell()?.classList.toggle('is-batch-mode', state.enabled);
    }

    function setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      if (!state.enabled) {
        state.selected.clear();
      }
      updateUI();
    }

    function toggleSelectAll(checked) {
      const visibleIds = getVisibleCheckboxes()
        .map((el) => el.dataset.batchId)
        .filter(Boolean);
      if (checked) {
        visibleIds.forEach((id) => state.selected.add(id));
      } else {
        visibleIds.forEach((id) => state.selected.delete(id));
      }
      updateUI();
    }

    function bind() {
      document.getElementById(options.toggleBtnId)?.addEventListener('click', () => {
        setEnabled(!state.enabled);
      });

      document.getElementById(options.selectAllId)?.addEventListener('change', (event) => {
        toggleSelectAll(event.target.checked);
      });

      document.getElementById(options.deleteBtnId)?.addEventListener('click', () => {
        if (!state.selected.size || typeof onDelete !== 'function') return;
        onDelete([...state.selected]);
      });

      if (root) {
        root.addEventListener('change', (event) => {
          const checkbox = event.target.closest('[data-batch-checkbox]');
          if (!checkbox) return;
          const id = checkbox.dataset.batchId;
          if (!id) return;
          if (checkbox.checked) state.selected.add(id);
          else state.selected.delete(id);
          updateUI();
        });

        root.addEventListener('click', (event) => {
          if (!state.enabled) return;
          if (event.target.closest('.list-batch-check, [data-batch-checkbox]')) return;
          const item = event.target.closest('[data-batch-item]');
          if (!item) return;
          if (event.target.closest('a')) {
            event.preventDefault();
          }
          const checkbox = item.querySelector('[data-batch-checkbox]');
          if (!checkbox) return;
          checkbox.checked = !checkbox.checked;
          const id = checkbox.dataset.batchId;
          if (!id) return;
          if (checkbox.checked) state.selected.add(id);
          else state.selected.delete(id);
          updateUI();
        });
      }
    }

    return manager;
  }

  window.listBatchUi = {
    createBatchManager,
  };
})();
