# AR Assets Studio — 產品需求文件 (PRD)

> 版本：v0.5（重新定義：場域優先、Tom 概念圖、OpenAI 生成、拋開 Dify）
> 日期：2026-06-04
> 狀態：核心生圖引擎 (gpt-image-1) 已實測可行，進 v2 實作

---

## 1. 產品定位

**AR Assets Studio**：為 AR 教學情境**生成 AR 物件**的網頁工具。以**場域 (venue)** 為單位，把一個場域會用到的所有 3D 物件素材建立起來，持續累積成 AR 素材庫。**不再依賴 Dify 教案工作流**——物件名稱、prompt、概念圖全部由 OpenAI 生成，不受教案限制。

學生在 AR 中與 AI 教練 **Tom** 對話、做情境英語練習；本工具產出兩類素材支撐該體驗。

## 2. 兩類 AR 物件

| 類別 | 用途 | 例（便利商店） |
|---|---|---|
| **情境物件 scene_object** | 維持沉浸感、佈置場景 | 收銀櫃檯、收銀機、貨架、咖啡機 |
| **關鍵字物件 keyword** | 用戶進入場景後練習用的關鍵字實物 | 薯片、飲料、御飯糰、零錢 |

兩類流程相同：**物件名稱 → 生圖 prompt → 生成圖片 → 審核 → 上架 LiG → （我決定）做 3D 模型**。

## 3. 核心流程（以新增「便利商店」為例）

```
1. 指定場域 venue：便利商店 (convenience store)
2. OpenAI 生成：
   a. 概念圖 (gpt-image-1, 以 Tom 為視覺中心)
      → Tom 當超商店員在櫃檯內與用戶對談；櫃台有收銀機、
        Tom 後方有咖啡機、用戶後方有貨架。用 Tom 參考圖確保一致。
   b. 情境物件名稱清單 (LLM) + 每個物件的生圖 prompt
   c. 關鍵字物件名稱清單 (LLM) + 每個物件的生圖 prompt
3. 概念圖 → 上架 LiG → 顯示在該場景頁
4. 逐物件：gpt-image-1 生圖 → 審核（通過/重生）→ 上架 LiG
5. 每個物件可按「製作 3D 模型」（image-to-3D，本期 stub，廠商待定）
6. 所有素材顯示 asset_id + url + tag
```

## 4. 已定案決策（2026-06-04）

- **拋開 Dify**：物件名稱與 prompt 改由 OpenAI LLM 生成。
- **生圖引擎**：**OpenAI gpt-image-1**（概念圖 + 物件圖皆用）。實測「黏土風袋裝薯片」白底、無亂碼、形態正確 ✅。取代失敗的 ComfyUI `z_image`。
- **概念圖**：以 **Tom** 為中心，用 **Tom 參考圖**（使用者提供）經 gpt-image-1 image edit/reference 確保跨場景一致。
- **風格**：暫以**黏土風 (clay render)** 為主，由**設定中心**集中管理、可彈性調參數。
- **3D**：每物件「我決定要不要做」→ image-to-3D，本期先做**按鈕 stub + 狀態**，廠商之後定（可插拔 adapter）。
- **上架**：全部上 LiG Cloud，網頁顯示 `asset_id` + `url` + `tag`。
- **技術棧**：Next.js 全棧 + TS + Tailwind + PostgreSQL（Drizzle），本地 Docker Postgres（host 5433）。

## 5. 外部 API 規格

### 5.1 OpenAI

- **物件命名 + prompt（LLM）**：chat completions（`OPENAI_MODEL`，預設 `gpt-4.1-mini`）。輸入場域 → 輸出 `{ scene_objects:[{en,zh,image_prompt}], keyword_objects:[...] }` 與概念圖場景描述。
- **生圖（gpt-image-1）**：
  - 物件：`images.generate({ model:"gpt-image-1", prompt, size, quality, background })` → 回 `b64_json`。
  - 概念圖：`images.edit({ model:"gpt-image-1", image:[tom_ref], prompt })` → 以 Tom 參考圖生成一致角色。
  - 回傳 b64 → 直接 base64 上傳 LiG（免下載步驟）。
- env：`OPENAI_API_KEY`、`OPENAI_MODEL`。

### 5.2 LiG Cloud 素材庫（三步：登入 → 上傳 → 取 URL）

- Base：`https://api.lig.com.tw`
- **登入** `POST /api/v1/login`，body `{ "user": { "email", "password" } }` → 回 `token`(JWT)。後續 `Authorization: Bearer <token>`；效期讀 JWT `exp`，過期自動重登。
- **上傳** `POST /api/v1/assets`，body `{ "assets":[{ "data":"<base64>", "ext":"png", "filename":"...", "tags":[...] }] }` → 回 `{ "id":["29422"] }`。`data` 用**純 base64**（不帶 `data:` 前綴，已驗證）。
- **取 URL** `GET /api/v1/get_asset/{id}` → `{ id, filename, url:"https://assets.lig.com.tw/...", content_type, tags }`。`url` 即回寫的 file_url。
- env：`LIG_BASE`、`LIG_EMAIL`、`LIG_PASSWORD`。

## 6. 資料模型（Drizzle / Postgres，`studio/lib/db/schema.ts`）

### scenario（場域 / 場景）
```
id, name_en, name_zh, venue_category,
concept_prompt,            # LLM 產生的概念圖場景描述
concept_image_url,         # LiG url（概念圖）
concept_lig_id,
tag_key (unique), status, created_at, updated_at
```

### asset（物件素材）
```
id, scenario_id,
type: scene_object | keyword,
name_en, name_zh,
image_prompt,              # LLM 產生的生圖 prompt
tag_key, tags[],
image_url, lig_image_id,   # LiG（圖片）
model_url, lig_model_id,   # LiG（.glb，3D 完成後）
model_status: none | requested | generating | done | failed,
status: pending | generating | review | uploaded | failed,
generation_meta jsonb, error, created_at, updated_at
唯一鍵：(type, tag_key) → 冪等去重
```

### app_setting（設定中心，單列 jsonb）
```
id=1, config jsonb:
  { style_preset, image_size, image_quality, background, gpt_image_model, naming_model, ... }
```

### generation_job（生成日誌）
```
id, asset_id, stage(image|model|upload), status, provider, request, result, error, ts
```

## 7. 系統架構（Next.js 全棧）

```
[Next.js 前端 + Tailwind]  scene 建立 / 概念圖 / 物件審核 / 設定 / 素材庫
[Next.js 後端 (Server Actions / Route Handlers)]
   ├─ OpenAI LLM：場域 → 物件清單 + prompt + 概念圖描述
   ├─ OpenAI gpt-image-1：概念圖（Tom ref）+ 物件圖
   ├─ 生成佇列（序列 worker；冪等：tag_key 命中即跳過）
   ├─ LiG Client：login → 上傳(b64) → get_asset → 回寫 url
   ├─ 設定中心（config）
   └─ DB（Postgres / Drizzle）
[OpenAI]   [LiG Cloud api.lig.com.tw]
```

> 金鑰全進 `.env`（server only）：`OPENAI_API_KEY`、`LIG_*`、`DATABASE_URL`。

## 8. 設定中心（可調參數）

- 風格 preset（預設「黏土風」；prompt 後綴模板）
- 生圖：size（1024²…）、quality（low/medium/high）、background（白底/透明）
- 模型：gpt-image model、naming LLM model
- 每場景物件數上限、命名語言等

## 9. 非功能需求

- **冪等累積**：同物件（type+tag_key）不重生。
- **可追溯**：保留 prompt / 模型 / 來源於 generation_meta + generation_job。
- **成本可控**：gpt-image-1 為付費，提供配額 / 審核 gate（壞圖不上架）。
- **持續運作**：序列 worker，可批次背景生成。

## 10. 待確認

| # | 問題 |
|---|------|
| Q-Tom | Tom 參考圖（使用者提供）→ 放 `studio/assets/tom.png` 或設定中心上傳 |
| Q-3D | image-to-3D 廠商（Meshy/Tripo/Rodin…）— 本期 stub，之後定 |
| Q-Venue | 預設場域清單（咖啡店/便利商店/教室/醫務室/百貨/火車站/機場…）是否固定選單 + 自由輸入 |

## 11. 里程碑

- **v2-M1 引擎**：場域 → OpenAI 物件清單 + prompt；gpt-image-1 物件生圖 → 審核 → LiG 上架（asset_id/url/tag）。冪等佇列。
- **v2-M2 概念圖**：Tom 參考圖 → gpt-image-1 概念圖 → LiG → 場景頁呈現。
- **v2-M3 設定中心**：風格/參數集中管理並套用。
- **v2-M4 3D**：接 image-to-3D（廠商定案）→ `.glb` → LiG → `<model-viewer>` 預覽；「製作 3D」由 stub 轉真實。

---

## 附錄：歷史結論（v0.1–v0.4）

- **z_image 不適用**：ComfyUI `z_image` 對「可愛黏土生物 + 浮雕假字」有強先驗、無視物件名詞與 negative prompt，調 prompt/參數無法修正 → 改用 OpenAI gpt-image-1。
- **LiG / gpt-image-1 / 基礎建設**：M0/M1 已驗證 LiG 三步上傳、Drizzle schema、序列佇列、審核 UI、Next.js 16（async params）。這些基礎沿用至 v2。
- Dify 教案 API（`dify.lig.com.tw`）整合已**停用**；保留為未來「教案查素材庫」方向二的可能對接點。
