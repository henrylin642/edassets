# ComfyUI 生成 API — 使用文件

LightEra 內部 AI 生圖服務。基於 ComfyUI，支援多 workflow 動態切換。

---

## 基本資訊

| 項目 | 值 |
|---|---|
| 服務網址 | `https://comfyapi.ezuse.ai` |
| 認證方式 | HTTP Header：`x-api-key: 你的key` |
| 任務模式 | 非同步（送出 → 輪詢狀態 → 取結果） |

> 你的 API Key 由管理員（Henry）發給，請勿外流或寫進公開的前端程式碼。

---

## 快速開始

三步驟：送任務 → 查狀態 → 拿圖。

### 1. 送出生圖任務

```
POST /generate
Header: x-api-key: 你的key
Body (JSON):
{
  "workflow_id": "z_image",
  "params": {
    "positive_prompt": "a cute red panda, 3D clay render style"
  }
}
```

回傳：
```json
{ "task_id": "07f99771-...", "status": "queued" }
```

### 2. 查詢任務狀態（用上一步的 task_id）

```
GET /status/{task_id}
Header: x-api-key: 你的key
```

回傳（生成中）：
```json
{ "task_id": "...", "status": "running", "error": null, "image_urls": [] }
```

回傳（完成）：
```json
{
  "task_id": "...",
  "status": "completed",
  "error": null,
  "image_urls": ["https://comfyapi.ezuse.ai/img?filename=...&sig=..."]
}
```

`status` 會經歷 `queued` → `running` → `completed`（或 `failed`）。
建議每 3-5 秒輪詢一次，直到變 `completed` 或 `failed`。

### 3. 取得圖片

`image_urls` 裡的網址帶簽章（`sig`），可直接用瀏覽器、img 標籤、或下游程式開啟，**不需要再帶 key**。

---

## 完整端點列表

| 方法 | 路徑 | 說明 | 需要 key |
|---|---|---|---|
| GET | `/health` | 健康檢查 | 否 |
| GET | `/workflows` | 列出可用的 workflow | 是 |
| POST | `/generate` | 送出生圖任務 | 是 |
| GET | `/status/{task_id}` | 查任務狀態 | 是 |
| GET | `/img?...&sig=...` | 取圖（帶簽章，免 key） | 否（靠簽章） |

---

## 參數說明（workflow: z_image）

`params` 裡可帶的欄位，全部選填，不帶就用預設值：

| 參數 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `positive_prompt` | string | `"a photo"` | 正向提示詞（要生什麼） |
| `negative_prompt` | string | 預設一組 | 負向提示詞（不要什麼） |
| `seed` | int | 隨機 | 固定 seed 可重現同張圖 |
| `steps` | int | 20 | 取樣步數，越高越精細也越慢 |
| `cfg` | float | 2.5 | 提示詞遵循強度 |
| `width` | int | 1024 | 寬 |
| `height` | int | 1024 | 高 |

---

## 範例程式

### curl（Mac / Linux / WSL）

```bash
KEY="你的key"
BASE="https://comfyapi.ezuse.ai"

# 送任務
RESP=$(curl -s -X POST $BASE/generate \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"z_image","params":{"positive_prompt":"a cute red panda"}}')
echo $RESP
TASK=$(echo $RESP | python3 -c "import sys,json;print(json.load(sys.stdin)['task_id'])")

# 輪詢
while true; do
  S=$(curl -s $BASE/status/$TASK -H "x-api-key: $KEY")
  echo $S
  echo $S | grep -q '"completed"' && break
  echo $S | grep -q '"failed"' && break
  sleep 4
done
```

### Python

```python
import requests, time

BASE = "https://comfyapi.ezuse.ai"
KEY = "你的key"
H = {"x-api-key": KEY}

# 送任務
r = requests.post(f"{BASE}/generate", headers=H, json={
    "workflow_id": "z_image",
    "params": {"positive_prompt": "a cute red panda, 3D clay render"}
})
task_id = r.json()["task_id"]
print("task_id:", task_id)

# 輪詢
while True:
    s = requests.get(f"{BASE}/status/{task_id}", headers=H).json()
    print(s["status"])
    if s["status"] in ("completed", "failed"):
        break
    time.sleep(4)

# 拿圖
if s["status"] == "completed":
    print("圖片網址:", s["image_urls"][0])
```

### PowerShell（Windows）

```powershell
$BASE = "https://comfyapi.ezuse.ai"
$H = @{ "x-api-key" = "你的key" }

# 送任務
$body = @{
    workflow_id = "z_image"
    params = @{ positive_prompt = "a cute red panda" }
} | ConvertTo-Json
$r = Invoke-RestMethod -Uri "$BASE/generate" -Method Post -Headers $H -ContentType "application/json" -Body $body
$task = $r.task_id

# 輪詢
do {
    Start-Sleep -Seconds 4
    $s = Invoke-RestMethod -Uri "$BASE/status/$task" -Headers $H
    $s.status
} while ($s.status -notin @("completed","failed"))

# 拿圖
$s.image_urls
```

---

## 在 Dify 裡使用

HTTP Request 節點設定：
- Create 節點：`POST https://comfyapi.ezuse.ai/generate`，Header `x-api-key`，body 帶 `workflow_id` + `params`
- 輪詢節點：`GET https://comfyapi.ezuse.ai/status/{task_id}`
- 判斷 `status == "completed"` 結束輪詢
- 從 `image_urls[0]` 取圖

---

## 錯誤排查

| 回傳 | 原因 | 解法 |
|---|---|---|
| `{"detail":"Invalid API key"}` | key 錯或沒帶 | 檢查 `x-api-key` header 拼字（小心多餘空格/底線） |
| `{"detail":"workflow not found"}` | workflow_id 打錯 | 先呼叫 `/workflows` 看有哪些 |
| `status` 一直 `running` 不變 | 生圖較慢或 GPU 忙 | 多等，或拉長輪詢上限 |
| `status: failed` | workflow 執行出錯 | 看 `error` 欄位，通常是參數或模型問題 |
| 圖網址打不開 | 用了舊的 `/result` 連結 | 改用 `image_urls` 裡帶 `sig` 的 `/img` 連結 |

---

## 注意事項

- 本服務跑在單張 GPU，**一次只能處理一個生圖任務**，多人同時送會排隊。
- 服務網址固定（`comfyapi.ezuse.ai`），但底層 GPU 實例若重啟，可能短暫中斷，看到連不上稍等重試。
- 生成的圖檔暫存在伺服器，**請及時下載保存**，不保證長期保留。
- 有問題找 Henry。
