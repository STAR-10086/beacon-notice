# Beacon Notice

面向独立开发者的**轻量多应用 Markdown 与图文公告系统**：
- **单容器全合一（`server/` + `web/`）**：Node.js + Express 托管 `/api/*`、上传图片 `/uploads/*` 以及构建后的 React 管理后台 `/admin`，JSON 原子落盘，零外部数据库依赖；
- **零公网端口暴露**：仅绑定 `127.0.0.1:3080`，通过宿主机 **Cloudflare Tunnel** 反代，并配合 **Cloudflare Zero Trust Access** 实现管理后台免密登录；
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

验证本机服务：

```bash
curl http://127.0.0.1:3080/health
```

---

## 二、Cloudflare Tunnel 与 Zero Trust Access 配置（以 `notice.buct.one` 为例）

1. **Cloudflare Tunnel（Public Hostname）**：
   - Domain：`notice.buct.one`
   - Service：`HTTP` → `http://127.0.0.1:3080`
2. **Cloudflare Zero Trust → Access → Applications（Self-hosted）**：
   - 仅保护管理后台与管理接口，创建两条路径（或两个 Application）：
     - `notice.buct.one/admin*`
     - `notice.buct.one/api/admin/*`
   - Policy：`Allow`，规则选 `Emails` 填入你自己的邮箱（与 `.env` 中 `CF_ACCESS_ALLOWED_EMAILS` 一致）。
   - **不要**把 `/api/notices` 与 `/uploads/*` 放进 Access 保护，确保客户端 App 可以公开拉取公告与图片。
3. **打开后台**：
   - 浏览器访问 `https://notice.buct.one/admin`，通过 Cloudflare 邮箱验证码登录后即可直接进入编辑器，无需再输入 Token。
   - 如需在本地无 Zero Trust 环境下调试，可在 `.env` 中设置 `ADMIN_TOKEN`，后台会自动在 401 时回退展示 Token 登录框。

---

## 三、接口说明

### 1. 客户端只读接口（公开）

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

### 2. 管理接口（受 Zero Trust 或 Bearer Token 保护）

- `GET /api/admin/me`：返回当前鉴权方式与登录邮箱
- `GET /api/admin/notices`：获取全部公告（含未生效/已过期）
- `POST /api/admin/notices`：新建公告
- `PUT /api/admin/notices/:id`：更新公告
- `DELETE /api/admin/notices/:id`：删除公告
- `POST /api/admin/upload`：上传图片（`multipart/form-data` 字段 `file`，最大 5MB）
