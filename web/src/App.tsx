import React, { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface NoticeRecord {
  id: string;
  appId: string;
  title: string;
  summary: string;
  markdown: string;
  level: 'info' | 'warning';
  popup: boolean;
  pinned: boolean;
  dismissible: boolean;
  enabled: boolean;
  actionText: string;
  actionUrl: string;
  minVersionCode: number;
  maxVersionCode: number;
  publishedAt: number;
  updatedAt?: number;
  expiresAt: number | null;
}

interface NoticeDraft {
  id?: string;
  appId: string;
  title: string;
  summary: string;
  markdown: string;
  level: 'info' | 'warning';
  popup: boolean;
  pinned: boolean;
  dismissible: boolean;
  enabled: boolean;
  actionText: string;
  actionUrl: string;
  minVersionCode: string;
  maxVersionCode: string;
  expiresAtLocal: string;
}

const STORAGE_URL_KEY = 'beacon_notice_api_url';
const STORAGE_TOKEN_KEY = 'beacon_notice_admin_token';

function toLocalDateTimeValue(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(appId: string): NoticeDraft {
  return {
    appId: appId === '__all__' ? 'buct-one' : appId,
    title: '',
    summary: '',
    markdown: '',
    level: 'info',
    popup: true,
    pinned: false,
    dismissible: true,
    enabled: true,
    actionText: '',
    actionUrl: '',
    minVersionCode: '0',
    maxVersionCode: '0',
    expiresAtLocal: ''
  };
}

function toDraft(n: NoticeRecord): NoticeDraft {
  return {
    id: n.id,
    appId: n.appId,
    title: n.title,
    summary: n.summary,
    markdown: n.markdown,
    level: n.level,
    popup: n.popup,
    pinned: n.pinned,
    dismissible: n.dismissible,
    enabled: n.enabled,
    actionText: n.actionText,
    actionUrl: n.actionUrl,
    minVersionCode: String(n.minVersionCode || 0),
    maxVersionCode: String(n.maxVersionCode || 0),
    expiresAtLocal: toLocalDateTimeValue(n.expiresAt)
  };
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(STORAGE_URL_KEY) || 'https://notice.buct.one');
  const [token, setToken] = useState(() => sessionStorage.getItem(STORAGE_TOKEN_KEY) || '');
  const [connected, setConnected] = useState(false);

  const [notices, setNotices] = useState<NoticeRecord[]>([]);
  const [appFilter, setAppFilter] = useState('__all__');
  const [draft, setDraft] = useState<NoticeDraft>(() => emptyDraft('buct-one'));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cleanBase = apiUrl.trim().replace(/\/+$/, '');

  async function apiFetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token.trim()}`);
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const resp = await fetch(`${cleanBase}${path}`, { ...init, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
  }

  async function loadNotices(keepSelection = true) {
    setBusy(true);
    setStatusMsg(null);
    try {
      const data = await apiFetch('/api/admin/notices');
      const list: NoticeRecord[] = data.notices || [];
      setNotices(list);
      setConnected(true);
      localStorage.setItem(STORAGE_URL_KEY, cleanBase);
      sessionStorage.setItem(STORAGE_TOKEN_KEY, token.trim());
      if (!keepSelection && list.length > 0) {
        setDraft(toDraft(list[0]));
      }
    } catch (err: any) {
      setStatusMsg({ text: err.message || '连接失败', error: true });
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (token.trim()) {
      loadNotices(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const knownApps = useMemo(() => {
    const set = new Set<string>(['buct-one', 'buct-one-ios', '*']);
    notices.forEach((n) => set.add(n.appId));
    return Array.from(set);
  }, [notices]);

  const visibleNotices = useMemo(() => {
    if (appFilter === '__all__') return notices;
    return notices.filter((n) => n.appId === appFilter);
  }, [notices, appFilter]);

  const renderedHtml = useMemo(() => {
    const raw = marked.parse(draft.markdown || '*暂无正文内容*') as string;
    return DOMPurify.sanitize(raw);
  }, [draft.markdown]);

  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => ({ ...d, markdown: `${d.markdown}\n${snippet}` }));
      return;
    }
    const start = el.selectionStart ?? draft.markdown.length;
    const end = el.selectionEnd ?? draft.markdown.length;
    const next = draft.markdown.slice(0, start) + snippet + draft.markdown.slice(end);
    setDraft((d) => ({ ...d, markdown: next }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    setStatusMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiFetch('/api/admin/upload', { method: 'POST', body: form });
      insertAtCursor(`\n![${file.name.replace(/\.[^.]+$/, '')}](${data.url})\n`);
      setStatusMsg({ text: `图片已上传：${data.filename}` });
    } catch (err: any) {
      setStatusMsg({ text: err.message || '图片上传失败', error: true });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      setStatusMsg({ text: '请填写公告标题', error: true });
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const expiresAt = draft.expiresAtLocal ? new Date(draft.expiresAtLocal).getTime() : null;
      const payload = {
        appId: draft.appId.trim() || 'buct-one',
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        markdown: draft.markdown,
        level: draft.level,
        popup: draft.popup,
        pinned: draft.pinned,
        dismissible: draft.dismissible,
        enabled: draft.enabled,
        actionText: draft.actionText.trim(),
        actionUrl: draft.actionUrl.trim(),
        minVersionCode: Number(draft.minVersionCode || 0) || 0,
        maxVersionCode: Number(draft.maxVersionCode || 0) || 0,
        expiresAt
      };
      const isUpdate = Boolean(draft.id);
      const data = await apiFetch(isUpdate ? `/api/admin/notices/${draft.id}` : '/api/admin/notices', {
        method: isUpdate ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      await loadNotices(true);
      if (data.notice) setDraft(toDraft(data.notice));
      setStatusMsg({ text: isUpdate ? '公告已更新并生效' : '新公告已发布' });
    } catch (err: any) {
      setStatusMsg({ text: err.message || '保存失败', error: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    if (!window.confirm(`确定永久删除公告「${draft.title}」吗？`)) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      await apiFetch(`/api/admin/notices/${draft.id}`, { method: 'DELETE' });
      await loadNotices(false);
      setDraft(emptyDraft(appFilter));
      setStatusMsg({ text: '公告已删除' });
    } catch (err: any) {
      setStatusMsg({ text: err.message || '删除失败', error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!connected) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Beacon Notice · 公告管理台</h1>
          <p className="muted">轻量多应用 Markdown 与图文公告服务，支持按 App ID 与版本号投放。</p>
          <div className="field">
            <label>后端服务地址</label>
            <input
              className="input"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://notice.buct.one"
            />
          </div>
          <div className="field">
            <label>管理员密钥（ADMIN_TOKEN）</label>
            <input
              className="input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="输入服务器配置的 ADMIN_TOKEN"
              onKeyDown={(e) => e.key === 'Enter' && loadNotices(false)}
            />
          </div>
          {statusMsg && (
            <div className={`status-bar ${statusMsg.error ? 'error' : ''}`}>{statusMsg.text}</div>
          )}
          <button className="btn primary" disabled={busy || !token.trim()} onClick={() => loadNotices(false)}>
            {busy ? '正在连接…' : '连接并进入管理台'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <strong>Beacon Notice · 多应用公告台</strong>
          <select
            className="select"
            style={{ width: 'auto', minWidth: 160 }}
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
          >
            <option value="__all__">全部应用（{notices.length}）</option>
            {knownApps.map((app) => (
              <option key={app} value={app}>
                {app === '*' ? '* 全局广播' : app}
              </option>
            ))}
          </select>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => loadNotices(true)} disabled={busy}>
            刷新
          </button>
          <button className="btn primary" onClick={() => setDraft(emptyDraft(appFilter))}>
            + 新建公告
          </button>
          <button
            className="btn"
            onClick={() => {
              sessionStorage.removeItem(STORAGE_TOKEN_KEY);
              setToken('');
              setConnected(false);
            }}
          >
            退出
          </button>
        </div>
      </header>

      {statusMsg && (
        <div className={`status-bar ${statusMsg.error ? 'error' : ''}`}>{statusMsg.text}</div>
      )}

      <div className="main-grid">
        <aside className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>公告列表（{visibleNotices.length}）</strong>
          </div>
          {visibleNotices.length === 0 ? (
            <p className="muted">暂无公告，点击右上角「新建公告」创建。</p>
          ) : (
            visibleNotices.map((n) => (
              <div
                key={n.id}
                className={`notice-item ${draft.id === n.id ? 'active' : ''}`}
                onClick={() => setDraft(toDraft(n))}
              >
                <div className="notice-item-title">
                  <span>{n.title}</span>
                </div>
                <div className="badges">
                  <span className="badge">{n.appId}</span>
                  {n.level === 'warning' && <span className="badge warn">重要提醒</span>}
                  {n.pinned && <span className="badge">置顶</span>}
                  {n.popup && <span className="badge">弹窗</span>}
                  {!n.enabled && <span className="badge off">已停用</span>}
                </div>
              </div>
            ))
          )}
        </aside>

        <main className="panel">
          <div className="form-grid">
            <div className="field">
              <label>目标应用 ID（填 * 表示全部应用可见）</label>
              <input
                className="input"
                list="known-apps"
                value={draft.appId}
                onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                placeholder="buct-one"
              />
              <datalist id="known-apps">
                {knownApps.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>公告级别</label>
              <select
                className="select"
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value as 'info' | 'warning' })}
              >
                <option value="info">普通公告（info）</option>
                <option value="warning">重要提醒（warning）</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>公告标题</label>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="例如：BUCT One 官方交流群已建立"
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label>一句话摘要（可选，用于列表展示）</label>
              <input
                className="input"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="欢迎加群反馈建议或蹲 iOS 内测"
              />
            </div>
            <div className="field">
              <label>过期时间（留空则长期有效）</label>
              <input
                className="input"
                type="datetime-local"
                value={draft.expiresAtLocal}
                onChange={(e) => setDraft({ ...draft, expiresAtLocal: e.target.value })}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>行动按钮文案（可选）</label>
              <input
                className="input"
                value={draft.actionText}
                onChange={(e) => setDraft({ ...draft, actionText: e.target.value })}
                placeholder="例如：打开官网"
              />
            </div>
            <div className="field">
              <label>行动按钮链接（可选）</label>
              <input
                className="input"
                value={draft.actionUrl}
                onChange={(e) => setDraft({ ...draft, actionUrl: e.target.value })}
                placeholder="https://buct.one"
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>最小 versionCode（0 表示不限）</label>
              <input
                className="input"
                type="number"
                value={draft.minVersionCode}
                onChange={(e) => setDraft({ ...draft, minVersionCode: e.target.value })}
              />
            </div>
            <div className="field">
              <label>最大 versionCode（0 表示不限）</label>
              <input
                className="input"
                type="number"
                value={draft.maxVersionCode}
                onChange={(e) => setDraft({ ...draft, maxVersionCode: e.target.value })}
              />
            </div>
          </div>

          <div className="toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              上线启用
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.popup}
                onChange={(e) => setDraft({ ...draft, popup: e.target.checked })}
              />
              启动自动弹窗（未读弹一次）
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              置顶显示
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.dismissible}
                onChange={(e) => setDraft({ ...draft, dismissible: e.target.checked })}
              />
              允许用户关闭
            </label>
          </div>

          <div className="editor-split">
            <div className="editor-pane">
              <div className="editor-toolbar">
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                  Markdown 正文（支持粘贴截图 / 拖拽图片上传）
                </label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? '上传中…' : '插入图片'}
                  </button>
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className="textarea md"
                value={draft.markdown}
                onChange={(e) => setDraft({ ...draft, markdown: e.target.value })}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile();
                      if (file) {
                        e.preventDefault();
                        handleImageUpload(file);
                        break;
                      }
                    }
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const file = e.dataTransfer?.files?.[0];
                  if (file && file.type.startsWith('image/')) {
                    e.preventDefault();
                    handleImageUpload(file);
                  }
                }}
                placeholder="支持标准 Markdown：# 标题、**加粗**、- 列表、`代码`、![图片](https://...)"
              />
            </div>

            <div className="editor-pane">
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>实时预览</label>
              <div className="preview-box" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            {draft.id ? (
              <button className="btn danger" disabled={busy} onClick={handleDelete}>
                删除公告
              </button>
            ) : (
              <span />
            )}
            <button className="btn primary" disabled={busy} onClick={handleSave}>
              {busy ? '保存中…' : draft.id ? '保存修改' : '发布公告'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
