# Beacon Notice

面向独立开发者的**轻量多应用 Markdown 与图文公告系统**：
- **单容器双端口物理隔离**：
  - **公开只读端口 `3080`**：仅提供 `/api/notices`、`/uploads/*`、`/health`，其余路径一律 `404`（适合对接 Cloudflare for SaaS 优选域名，如 `notice.buct.one`）；
  - **独立管理端口 `3081`**：托管 React 管理后台（`/`）与 `/api/admin/*`，配合 Cloudflare Zero Trust 整站保护（如 `notice.star10086qaq.pp.ua`）；
- **零公网端口暴露**：两个端口均只绑定 `127.0.0.1`，由宿主机 **Cloudflare Tunnel** 反代；
- **核心能力**：多应用隔离（含 `*` 全局广播）、Markdown 左右分栏实时预览、截图粘贴 / 拖拽 / 按钮上传图片、定时过期、启动弹窗与版本号定向投放。

---

## 一、VPS 一键 Docker 部署

```bash
git clone https://github.com/STAR-10086/beacon-notice.git
cd beacon-notice
cp .env.example .env
# 编辑 .env，设置 CF_ACCESS_ALLOWED_EMAILS 与 PUBLIC_BASE_URL（如 https://notice.buct.one）
docker compose up -d --build
```

验证本机双端口服务：

```bash
curl http://127.0.0.1:3080/health
curl http://127.0.0.1:3081/health
```

---

## 二、Cloudflare Tunnel、SaaS 优选与 Zero Trust 配置

### 1. Cloudflare Tunnel（Public Hostname）

在 Tunnel 中添加两条指向本机不同端口的记录：

- **管理端域名**：`notice.star10086qaq.pp.ua` → `HTTP` `127.0.0.1:3081`
- **用户端回源域名**（供 `notice.buct.one` CNAME / SaaS 优选回源）：如 `notice-origin.star10086qaq.pp.ua`（或直接 `notice.buct.one`）→ `HTTP` `127.0.0.1:3080`

> 端口 `3080` 上物理不存在任何 `/api/admin/*` 与管理页面路由，即使 SaaS 优选改写回源 Host 也绝对不会暴露管理接口。

### 2. Cloudflare Zero Trust → Access → Applications（Self-hosted）

直接对整个管理域名 `notice.star10086qaq.pp.ua` 开启保护（无需写路径规则）：
- **Domain**：`notice.star10086qaq.pp.ua`（Path 留空即可）
- **Policy**：`Allow`，规则选 `Emails` 填入你的邮箱（与 `.env` 中 `CF_ACCESS_ALLOWED_EMAILS` 一致）

### 3. 登录后台与图片链接

- 浏览器直接访问 `https://notice.star10086qaq.pp.ua`，通过 Cloudflare 邮箱验证码后即可免密进入管理后台；
- 上传图片会自动按 `PUBLIC_BASE_URL`（如 `https://notice.buct.one`）生成公网加速链接，App 端拉取公告和图片全部走 `notice.buct.one` 优选节点。

---

## 三、接口说明

### 1. 客户端只读接口（公开，端口 `3080`）

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

### 2. 管理接口（仅端口 `3081`，受 Zero Trust 或 Bearer Token 保护）

- `GET /api/admin/me`：返回当前鉴权方式与登录邮箱
- `GET /api/admin/notices`：获取全部公告（含未生效/已过期）
- `POST /api/admin/notices`：新建公告
- `PUT /api/admin/notices/:id`：更新公告
- `DELETE /api/admin/notices/:id`：删除公告
- `POST /api/admin/upload`：上传图片（`multipart/form-data` 字段 `file`，最大 5MB）
