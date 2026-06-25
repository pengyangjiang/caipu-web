# 后端骨架

这是一个不依赖第三方包的最小后台骨架，先把内容读取、保存、版本控制和管理员登录态跑通。

## 启动

```bash
node backend/server.js
```

默认端口：`3000`

## 环境变量

- `PORT`：服务端口，默认 `3000`
- `ADMIN_PASSWORD`：管理员密码，默认 `admin123`
- `ADMIN_TOKEN`：管理员令牌，默认 `demo-admin-token`

## 接口

- `GET /` / `GET /index.html`：前端首页静态文件
- `GET /recipe.html`、`GET /ingredient.html`、`GET /edit.html`、`GET /login.html`：前端静态页面
- `GET /health`
- `GET /api/me`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/search-index`
- `GET /api/recipes`
- `GET /api/recipes/:id`
- `PATCH /api/recipes/:id`
- `GET /api/ingredients`
- `GET /api/ingredients/:id`
- `PATCH /api/ingredients/:id`

## 说明

- 首次启动会自动读取当前前端的 `data.js`、`recipe-details.js`、`ingredient-details.js` 作为种子数据。
- 更新会落到 `backend/storage/recipes.json` 和 `backend/storage/ingredients.json`。
- `PATCH` 默认要求管理员令牌，通过 `Authorization: Bearer <token>` 或 `X-Admin-Token` 传递。

## Cloudflare Pages 部署

前端部署到 Cloudflare Pages 时，请确保仓库根目录包含 `functions/` 文件夹（已提供 `functions/api/[[path]].js`）。

1. 重新部署项目，使 Pages Functions 生效。
2. 在 Cloudflare 控制台 → Pages 项目 → **Settings → Environment variables** 中，为 **Production**（和 Preview，如需要）添加以下变量，并勾选 **Encrypt**（加密存储）：
   - `ADMIN_PASSWORD`：管理员登录密码（只存在 Cloudflare，不要写进代码仓库）
   - `ADMIN_TOKEN`：登录成功后返回的长随机令牌（建议 64 位十六进制，与密码不同）
3. 若需要在线保存编辑内容，在 Functions → KV namespace bindings 中绑定 `CONTENT_KV`。
   - 未绑定 KV 时，登录和读取正常，但 `PATCH` 保存会返回 503。
4. 线上环境会自动使用当前域名作为 API 地址（见 `config.js`），无需再指向 `localhost:3000`。
5. 线上 API **不再使用** `admin123` / `demo-admin-token` 等默认凭据；未配置环境变量时登录会返回 503。

### 安全说明

- 密码和令牌只应配置在 Cloudflare 加密环境变量中，**切勿**提交到 Git 或写在 HTML/JS 里。
- `ADMIN_PASSWORD` 用于登录页输入；`ADMIN_TOKEN` 是登录后浏览器保存的会话凭证，应使用足够长的随机字符串。
- 修改密码或令牌后需重新部署，且所有已登录设备要重新登录。
- 本地 Node 后端（`backend/server.js`）仍可用环境变量覆盖，默认值仅供本机开发。
