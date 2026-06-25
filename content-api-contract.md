# 内容接口契约

本文档定义菜谱和食材在前端与后端之间共享的统一字段，便于后续直接接入数据库和管理后台。

## 通用字段

所有内容对象都建议包含：

- `id`: 字符串，内容唯一标识。
- `version`: 数字，版本号，每次保存递增。
- `updatedAt`: 字符串，ISO 8601 时间。
- `createdAt`: 字符串，可选，首次创建时间。
- `status`: 字符串，可选，如 `draft`、`published`、`archived`。
- `updatedBy`: 对象，可选，记录最后修改人。

## 菜谱对象

### 读取接口返回

`GET /api/recipes/:id`

```json
{
  "id": "grilled-chicken-salad",
  "version": 3,
  "updatedAt": "2026-06-24T12:30:00.000Z",
  "name": "香煎鸡胸沙拉",
  "coverImage": "https://...",
  "desc": "高蛋白、低负担的日常轻食",
  "categories": ["lunch", "dinner", "light"],
  "tags": ["减脂", "快手"],
  "statusTags": ["30分钟完成", "1人份"],
  "calories": {
    "perServing": 286,
    "total": 286,
    "unit": "千卡",
    "note": "按 1 人份计算"
  },
  "summary": [
    { "label": "热量", "value": "286 kcal" }
  ],
  "meta": [
    { "label": "烹饪时长", "value": "30 分钟" }
  ],
  "ingredients": [
    {
      "group": "主料",
      "items": [
        { "name": "鸡胸肉", "amount": "180g" }
      ]
    }
  ],
  "ingredientNames": ["鸡胸肉"],
  "ingredientCount": 1,
  "steps": [
    { "title": "准备食材", "content": "...", "time": "5 分钟" }
  ],
  "nutrition": [
    { "label": "蛋白质", "value": "31g", "unit": "g" }
  ],
  "tips": [
    { "title": "口感", "content": "..." }
  ]
}
```

### 更新接口请求体

`PATCH /api/recipes/:id`

建议提交和读取结构一致，至少包含：

- `name`
- `coverImage`
- `desc`
- `categories`
- `tags`
- `statusTags`
- `calories`
- `summary`
- `meta`
- `ingredients`
- `ingredientNames`
- `ingredientCount`
- `steps`
- `nutrition`
- `tips`
- `version`
- `updatedAt`

## 食材对象

### 读取接口返回

`GET /api/ingredients/:id`

```json
{
  "id": "chicken-breast",
  "version": 2,
  "updatedAt": "2026-06-24T12:40:00.000Z",
  "name": "鸡胸肉",
  "aliases": ["鸡胸", "鸡胸肉"],
  "category": "蛋白质",
  "unit": "100g",
  "caloriesPer100g": 133,
  "nutritionPer100g": {
    "protein": 22.3,
    "fat": 5,
    "carbs": 0,
    "fiber": 0
  },
  "handlingTips": ["冷藏解冻后先擦干表面水分。"],
  "storageTips": ["冷藏建议 1-2 天内食用。"],
  "cookingNotes": ["适合煎、烤、煮、撕丝做沙拉"]
}
```

### 更新接口请求体

`PATCH /api/ingredients/:id`

建议提交和读取结构一致，至少包含：

- `name`
- `aliases`
- `category`
- `unit`
- `caloriesPer100g`
- `nutritionPer100g`
- `handlingTips`
- `storageTips`
- `cookingNotes`
- `version`
- `updatedAt`

## 权限与保存

- 普通用户只读，详情页不显示编辑入口。
- 管理员可进入 `edit.html` 保存修改。
- 保存失败时，前端可暂存草稿到本地，但正式数据仍应以后端为准。

## 版本策略

- 每次更新时 `version + 1`。
- `updatedAt` 使用后端时间，前端仅作展示与占位。
- 如果未来支持多人协作，可补充 `updatedBy` 和 `changeLog`。
