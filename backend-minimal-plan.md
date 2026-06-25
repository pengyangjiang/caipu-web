# 后端最小实施方案

目标：先做一个最小可用的内容管理后端，让 `recipe.html`、`ingredient.html` 和 `edit.html` 可以稳定读取与保存内容。

## 推荐技术栈

- Node.js + Express
- PostgreSQL 或 MySQL
- ORM 任选其一：Prisma / Drizzle / Sequelize
- 认证：Cookie Session 或 JWT 均可，先用简单的管理员登录态即可

## 最小接口

### 菜谱

- `GET /api/recipes/:id`
- `PATCH /api/recipes/:id`
- `GET /api/recipes`
- `GET /api/search-index`

### 食材

- `GET /api/ingredients/:id`
- `PATCH /api/ingredients/:id`
- `GET /api/ingredients`

### 管理

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/me`

## 返回规范

### 成功响应

```json
{
  "ok": true,
  "data": {
    "id": "grilled-chicken-salad",
    "version": 3,
    "updatedAt": "2026-06-24T12:30:00.000Z"
  }
}
```

### 错误响应

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Recipe not found"
  }
}
```

## 数据表建议

### `recipes`

- `id` varchar primary key
- `name` varchar not null
- `cover_image` text
- `desc` text
- `categories` json
- `tags` json
- `status_tags` json
- `calories` json
- `summary` json
- `meta` json
- `ingredients` json
- `ingredient_names` json
- `ingredient_count` int
- `steps` json
- `nutrition` json
- `tips` json
- `version` int not null default 1
- `updated_at` timestamp not null
- `created_at` timestamp not null
- `updated_by` varchar nullable
- `status` varchar not null default 'published'

### `ingredients`

- `id` varchar primary key
- `name` varchar not null
- `aliases` json
- `category` varchar
- `unit` varchar
- `calories_per100g` int
- `nutrition_per100g` json
- `handling_tips` json
- `storage_tips` json
- `cooking_notes` json
- `version` int not null default 1
- `updated_at` timestamp not null
- `created_at` timestamp not null
- `updated_by` varchar nullable
- `status` varchar not null default 'published'

## 保存规则

1. 先校验管理员身份。
2. 校验请求体字段类型。
3. 读取当前记录版本。
4. `version + 1` 后写入数据库。
5. 记录 `updated_at = now()`。
6. 返回更新后的完整对象。

## 最小校验

### 菜谱

- `name` 必填
- `ingredients` 必须是数组
- `steps` 必须是数组
- `calories.perServing`、`calories.total` 必须是数字

### 食材

- `name` 必填
- `caloriesPer100g` 必须是数字
- `nutritionPer100g` 必须是对象

## 接入前端的顺序

1. 先把 `GET /api/me` 和管理员登录态打通。
2. 再实现 `GET /api/recipes/:id` / `GET /api/ingredients/:id`。
3. 然后实现 `PATCH` 保存。
4. 最后把 `api-client.js` 的远程地址切到真实后端。

## 先做的最小版本

如果你想尽快上线，建议第一版只做：

- 读取单条详情
- 保存单条详情
- 管理员登录
- 版本号递增
- 更新时间写入

列表、搜索索引、草稿、多用户协作都可以后面再补。
