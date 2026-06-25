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
