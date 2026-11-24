# Beacon Notice

面向独立开发者的**轻量多应用 Markdown 与图文公告系统**：
- **后端（`server/`）**：Node.js + Express + Docker（单容器、JSON 原子落盘 + 本地图片上传托管，零外部数据库依赖），适合直接部署在已有 VPS 上；
- **管理后台（`web/`）**：Vite + React（部署在 Vercel），支持多应用隔离、Markdown 左右分栏实时预览、截图粘贴 / 拖拽 / 按钮上传图片、定时过期、启动弹窗与版本号定向投放。

---

## 一、VPS 一键 Docker 部署（后端）

```bash
git clone https://github.com/STAR-10086/beacon-notice.git
cd beacon-notice
cp .env.example .env
# 编辑 .env，设置强随机 ADMIN_TOKEN 与 PUBLIC_BASE_URL（如 https://notice.buct.one）
docker compose up -d --build
```

验证服务：

```bash
curl http://127.0.0.1:3080/health
```

### Nginx / Caddy 反向代理示例（以 `notice.buct.one` 为例）

**Caddy：**
```caddyfile
notice.buct.one {
    reverse_proxy 127.0.0.1:3080
}
```

**Nginx：**
```nginx
server {
    listen 443 ssl http2;
    server_name notice.buct.one;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 二、Vercel 部署（Markdown 管理后台）

1. 在 Vercel 导入本仓库；
2. **Root Directory** 选择 `web`；
3. Framework Preset 选择 `Vite`，Build Command `npm run build`，Output Directory `dist`；
4. 部署完成后打开页面，填入后端地址（如 `https://notice.buct.one`）与 `.env` 中的 `ADMIN_TOKEN` 即可直接发布带图 Markdown 公告。

---

## 三、客户端通用接口约定

任何 App（Android / iOS / Desktop / Web）只需请求一个只读接口即可接入：

```http
GET https://notice.buct.one/api/notices?app=buct-one&versionCode=11
```

返回示例：

```json
{
  "notices": [
    {
      "id": "n_a1b2c3d4",
      "appId": "buct-one",
      "title": "BUCT One 交流群已建立",
      "summary": "欢迎加群反馈建议或蹲 iOS 内测",
      "markdown": "欢迎加入 QQ 群：`xxxxxxxx`\n\n![群二维码](https://notice.buct.one/uploads/example.png)",
      "level": "info",
      "popup": true,
      "pinned": true,
      "dismissible": true,
      "actionText": "访问官网",
      "actionUrl": "https://buct.one",
      "minVersionCode": 1,
      "maxVersionCode": 0,
      "publishedAt": 1795536000000,
      "expiresAt": null
    }
  ],
  "serverTime": 1795536100000
}
```

- `appId = "*"` 表示全局广播，所有应用均可收到；
- `minVersionCode` / `maxVersionCode` 为 `0` 表示不限制版本。
