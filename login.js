const API_BASE_URL = (window.__API_BASE_URL__ || window.API_BASE_URL || 'http://localhost:3000').trim();

const form = document.getElementById('loginForm');
const passwordInput = document.getElementById('passwordInput');
const loginStatus = document.getElementById('loginStatus');
const sessionActions = document.getElementById('sessionActions');
const api = window.contentApi;

function getReturnTo() {
  const params = new URLSearchParams(window.location.search);
  return params.get('returnTo') || './index.html';
}

async function login(password) {
  const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `登录失败（${response.status}）`;
    throw new Error(message);
  }

  return payload.data;
}

function renderSessionActions(status) {
  if (!sessionActions) return;

  if (!status.hasToken) {
    sessionActions.innerHTML = '';
    return;
  }

  sessionActions.innerHTML = `
    <div class="auth-session-state">
      <strong>${status.isAdmin ? '当前已是管理员登录' : '当前已保存登录信息，但未验证通过'}</strong>
      <span class="auth-status">${status.checkedRemote ? '已与后端校验' : '仅本地保存'}</span>
      <button class="action-link" type="button" id="logoutFromLogin">退出登录</button>
    </div>
  `;

  const logoutButton = document.getElementById('logoutFromLogin');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      if (api) {
        api.clearAdminSession();
      } else {
        window.localStorage.removeItem('content-admin-token');
        window.localStorage.removeItem('content-admin-mode');
      }
      window.location.reload();
    });
  }
}

async function refreshSessionStatus() {
  if (!api) return;
  const status = await api.getSessionStatus();
  if (status.hasToken) {
    if (!status.isAdmin && status.checkedRemote) {
      api.clearAdminSession();
      loginStatus.textContent = '登录信息已失效，请重新登录';
      renderSessionActions({ hasToken: false, isAdmin: false, checkedRemote: true });
      return;
    }

    loginStatus.textContent = status.isAdmin ? '已登录管理员，可直接返回编辑页' : '已保存登录信息，但当前未通过后端验证';
  }
  renderSessionActions(status);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value.trim();
  if (!password) {
    loginStatus.textContent = '请输入管理员密码';
    return;
  }

  try {
    loginStatus.textContent = '正在登录...';
    const data = await login(password);
    window.localStorage.setItem('content-admin-token', data.token);
    window.localStorage.setItem('content-admin-mode', '1');
    loginStatus.textContent = '登录成功，正在跳转...';
    window.location.href = getReturnTo();
  } catch (error) {
    loginStatus.textContent = error.message || '登录失败';
  }
});

passwordInput.focus();
refreshSessionStatus();
