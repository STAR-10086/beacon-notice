const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const PORT = Number(process.env.PORT || 3080);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3081);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public'));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const NOTICES_FILE = path.join(DATA_DIR, 'notices.json');
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const TRUST_CF_ACCESS = String(process.env.TRUST_CF_ACCESS || 'false').toLowerCase() === 'true';
const CF_ACCESS_ALLOWED_EMAILS = String(process.env.CF_ACCESS_ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*').trim();
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

if (!ADMIN_TOKEN && !TRUST_CF_ACCESS) {
  console.warn('[beacon-notice] WARNING: Neither ADMIN_TOKEN nor TRUST_CF_ACCESS is enabled; /api/admin/* will reject requests.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(NOTICES_FILE)) {
  fs.writeFileSync(NOTICES_FILE, JSON.stringify({ notices: [] }, null, 2), 'utf8');
}

function readNotices() {
  try {
    const raw = fs.readFileSync(NOTICES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.notices) ? parsed.notices : [];
  } catch (err) {
    console.error('[beacon-notice] Failed to read notices.json:', err);
    return [];
  }
}

function writeNotices(notices) {
  const tmpFile = `${NOTICES_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify({ notices }, null, 2), 'utf8');
  fs.renameSync(tmpFile, NOTICES_FILE);
}

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  if (TRUST_CF_ACCESS) {
    const cfEmail = String(req.headers['cf-access-authenticated-user-email'] || '').trim().toLowerCase();
    if (cfEmail) {
      if (CF_ACCESS_ALLOWED_EMAILS.length === 0 || CF_ACCESS_ALLOWED_EMAILS.includes(cfEmail)) {
        req.adminIdentity = cfEmail;
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: email not in CF_ACCESS_ALLOWED_EMAILS' });
    }
  }

  if (ADMIN_TOKEN) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token && constantTimeEquals(token, ADMIN_TOKEN)) {
      req.adminIdentity = 'token';
      return next();
    }
  }

  if (!ADMIN_TOKEN && !TRUST_CF_ACCESS) {
    return res.status(503).json({ error: 'Server auth is not configured' });
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

const ALLOWED_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_EXT_BY_MIME[file.mimetype] || '.png';
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXT_BY_MIME[file.mimetype]) {
      return cb(new Error('Only png, jpg, webp, gif images are allowed'));
    }
    cb(null, true);
  }
});

const corsOrigins = CORS_ORIGIN === '*'
  ? '*'
  : CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

function createBaseApp() {
  const instance = express();
  instance.disable('x-powered-by');
  instance.set('trust proxy', true);
  instance.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  instance.use(express.json({ limit: '1mb' }));
  return instance;
}

function registerPublicRoutes(targetApp) {
  targetApp.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'beacon-notice', timestamp: Date.now() });
  });

  targetApp.get('/uploads/:filename', (req, res) => {
    const filename = path.basename(req.params.filename || '');
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  });

  targetApp.get('/api/notices', (req, res) => {
    const appId = String(req.query.app || '').trim();
    const versionCodeRaw = req.query.versionCode;
    const versionCode = versionCodeRaw !== undefined && versionCodeRaw !== ''
      ? Number(versionCodeRaw)
      : null;
    const now = Date.now();

    const list = readNotices()
      .filter((n) => {
        if (!n.enabled) return false;
        if (n.expiresAt && Number(n.expiresAt) > 0 && Number(n.expiresAt) <= now) return false;
        if (appId) {
          if (n.appId !== appId && n.appId !== '*') return false;
        }
        if (versionCode !== null && !Number.isNaN(versionCode)) {
          const minV = Number(n.minVersionCode || 0);
          const maxV = Number(n.maxVersionCode || 0);
          if (minV > 0 && versionCode < minV) return false;
          if (maxV > 0 && versionCode > maxV) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return Number(b.publishedAt || 0) - Number(a.publishedAt || 0);
      })
      .map((n) => ({
        id: n.id,
        appId: n.appId,
        title: n.title,
        summary: n.summary || '',
        markdown: n.markdown || '',
        level: n.level || 'info',
        popup: Boolean(n.popup),
        pinned: Boolean(n.pinned),
        dismissible: n.dismissible !== false,
        actionText: n.actionText || '',
        actionUrl: n.actionUrl || '',
        minVersionCode: Number(n.minVersionCode || 0),
        maxVersionCode: Number(n.maxVersionCode || 0),
        publishedAt: Number(n.publishedAt || 0),
        expiresAt: n.expiresAt ? Number(n.expiresAt) : null
      }));

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ notices: list, serverTime: now });
  });
}

// 1) Public-only server (for SaaS-accelerated user domain like notice.buct.one)
const publicApp = createBaseApp();
registerPublicRoutes(publicApp);
publicApp.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
publicApp.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Request failed' });
});

// 2) Admin + SPA server (for Zero Trust protected admin domain like notice.star10086qaq.pp.ua)
const adminApp = createBaseApp();
registerPublicRoutes(adminApp);

adminApp.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    identity: req.adminIdentity || 'unknown',
    mode: req.adminIdentity === 'token' ? 'token' : 'zero-trust'
  });
});

adminApp.get('/api/admin/apps', requireAdmin, (_req, res) => {
  const notices = readNotices();
  const counts = new Map();
  for (const n of notices) {
    const key = String(n.appId || 'default');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const apps = Array.from(counts.entries()).map(([appId, count]) => ({ appId, count }));
  res.json({ apps });
});

adminApp.get('/api/admin/notices', requireAdmin, (req, res) => {
  const filterApp = String(req.query.app || '').trim();
  let list = readNotices();
  if (filterApp && filterApp !== '__all__') {
    list = list.filter((n) => n.appId === filterApp);
  }
  list.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return Number(b.updatedAt || b.publishedAt || 0) - Number(a.updatedAt || a.publishedAt || 0);
  });
  res.json({ notices: list });
});

function sanitizeNoticePayload(body, existing = null) {
  const now = Date.now();
  const appId = String(body.appId || existing?.appId || 'buct-one').trim() || 'buct-one';
  const title = String(body.title || '').trim();
  if (!title) {
    throw new Error('Title is required');
  }
  const level = body.level === 'warning' ? 'warning' : 'info';
  const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
  return {
    id: existing?.id || `n_${crypto.randomUUID().slice(0, 8)}`,
    appId,
    title,
    summary: String(body.summary || '').trim(),
    markdown: String(body.markdown || ''),
    level,
    popup: Boolean(body.popup),
    pinned: Boolean(body.pinned),
    dismissible: body.dismissible !== false,
    enabled: body.enabled !== false,
    actionText: String(body.actionText || '').trim(),
    actionUrl: String(body.actionUrl || '').trim(),
    minVersionCode: Math.max(0, Number(body.minVersionCode || 0) || 0),
    maxVersionCode: Math.max(0, Number(body.maxVersionCode || 0) || 0),
    publishedAt: existing?.publishedAt || Number(body.publishedAt || now),
    updatedAt: now,
    expiresAt: expiresAt && !Number.isNaN(expiresAt) ? expiresAt : null
  };
}

adminApp.post('/api/admin/notices', requireAdmin, (req, res) => {
  try {
    const notices = readNotices();
    const created = sanitizeNoticePayload(req.body || {});
    notices.unshift(created);
    writeNotices(notices);
    res.status(201).json({ notice: created });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid payload' });
  }
});

adminApp.put('/api/admin/notices/:id', requireAdmin, (req, res) => {
  try {
    const notices = readNotices();
    const idx = notices.findIndex((n) => n.id === req.params.id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Notice not found' });
    }
    const updated = sanitizeNoticePayload(req.body || {}, notices[idx]);
    notices[idx] = updated;
    writeNotices(notices);
    res.json({ notice: updated });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid payload' });
  }
});

adminApp.delete('/api/admin/notices/:id', requireAdmin, (req, res) => {
  const notices = readNotices();
  const next = notices.filter((n) => n.id !== req.params.id);
  if (next.length === notices.length) {
    return res.status(404).json({ error: 'Notice not found' });
  }
  writeNotices(next);
  res.json({ ok: true });
});

adminApp.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }
  const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    url: `${baseUrl}/uploads/${req.file.filename}`,
    filename: req.file.filename,
    size: req.file.size
  });
});

if (fs.existsSync(PUBLIC_DIR)) {
  adminApp.use('/', express.static(PUBLIC_DIR, { index: 'index.html' }));
  adminApp.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

adminApp.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Request failed' });
});

publicApp.listen(PORT, '0.0.0.0', () => {
  console.log(`[beacon-notice] public server listening on 0.0.0.0:${PORT}, data=${DATA_DIR}`);
});

adminApp.listen(ADMIN_PORT, '0.0.0.0', () => {
  console.log(`[beacon-notice] admin server listening on 0.0.0.0:${ADMIN_PORT}, public=${PUBLIC_DIR}`);
});
