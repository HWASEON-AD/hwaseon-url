// server.js
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

/** =========================
 *  Persistent Disk 경로
 *  ========================= */
const DATA_DIR = '/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/** =========================
 *  보안/관리자 설정 (환경변수 지원)
 *  ========================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hwaseon@00';
const ADMIN_KEY = process.env.ADMIN_KEY || 'hwaseon-admin-key';

/** =========================
 *  이슈 4: 환경변수 미설정 경고 (서버 시작 시점, 서비스는 계속 실행)
 *  ========================= */
if (!process.env.ADMIN_PASSWORD) console.warn('[WARN] ADMIN_PASSWORD 미설정 — 기본값 사용 중');
if (!process.env.ADMIN_KEY) console.warn('[WARN] ADMIN_KEY 미설정 — 기본값 사용 중');
if (!process.env.SESSION_SECRET) console.warn('[WARN] SESSION_SECRET 미설정 — 기본값 사용 중');

/** =========================
 *  디렉토리 준비
 *  ========================= */
for (const dir of [DATA_DIR, SESSIONS_DIR, BACKUPS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** =========================
 *  CORS/파서/세션
 *  ========================= */
// 이슈 3: 프록시(Render) 뒤에서 secure 쿠키가 정상 동작하도록 신뢰 프록시 설정
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [
        'https://hwaseon-url.onrender.com', 'https://hwaseon-url.com',
        'https://amore-url.com', 'https://amos-url.com',
        'https://prmr-url.com', 'https://iope-url.com'
      ]
    : ['http://localhost:5001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'hwaseon-secret-key',
  resave: false,
  saveUninitialized: false,
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 24 * 60 * 60,
    reapInterval: 60 * 60,
    retries: 0
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // 이슈 3: 운영 환경에서만 secure 쿠키
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

/** 정적 파일 */
app.use(express.static(path.join(__dirname, 'public')));

/** =========================
 *  이슈 5: 로그인 Rate Limiting (1분 10회 제한)
 *  ========================= */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 10,             // 1분당 최대 10회
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '너무 많은 시도입니다. 잠시 후 다시 시도하세요.' }
});

/** 세션 디버그 (개발 환경만) */
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log('[DEBUG][Session]', {
      id: req.sessionID,
      user: req.session.user || null,
      path: req.path,
      method: req.method
    });
    next();
  });
}

/** =========================
 *  유틸 함수
 *  ========================= */
function readJSONSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[READ JSON FAIL] ${file}:`, e);
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  const temp = file + '.tmp';
  const bak = file + '.bak';
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, bak);
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    // sanity check
    JSON.parse(fs.readFileSync(temp, 'utf8'));
    fs.renameSync(temp, file);
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    return true;
  } catch (e) {
    console.error(`[WRITE JSON FAIL] ${file}:`, e);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (fs.existsSync(bak)) fs.renameSync(bak, file);
    return false;
  }
}

const saveUsers = (users) => writeJSONAtomic(USERS_FILE, users);
const loadUsers = () => readJSONSafe(USERS_FILE, { users: [] });

const saveDB = (db) => writeJSONAtomic(DB_FILE, db);
const loadDB = () => readJSONSafe(DB_FILE, {});

/** ID 생성 */
const genId = () => Date.now().toString();
const generateShortCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '';
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (typeof ip === 'string' && ip.includes('::ffff:')) ip = ip.substring(7);
  return ip || '';
}

/** 권한 헬퍼 */
function hasAdminSession(req) {
  return !!(req.session?.user?.isAdmin);
}
function hasValidAdminKey(req) {
  const key = req.body?.adminKey || req.headers['x-admin-key'];
  return key === ADMIN_KEY;
}
function ensureAdmin(req, res) {
  if (hasAdminSession(req) || hasValidAdminKey(req)) return true;
  res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
  return false;
}

/** =========================
 *  부트 타임 데이터 마이그레이션
 *  - id 없는 사용자에 id 부여
 *  ========================= */
(function migrateUsersIfNeeded() {
  const data = loadUsers();
  let changed = false;
  data.users = (data.users || []).map(u => {
    if (!u.id) {
      u.id = genId();
      changed = true;
    }
    if (typeof u.isAdmin !== 'boolean') {
      u.isAdmin = false;
      changed = true;
    }
    return u;
  });
  if (changed) {
    console.log('[MIGRATE] users.json: 누락된 id/isAdmin 보정');
    saveUsers(data);
  }
})();

/** =========================
 *  페이지 라우트
 *  ========================= */
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/signup', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'url.html')));
app.get('/multiple', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'multiple.html')));
app.get('/multiple.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'multiple.html')));
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin', (req, res) => {
  if (hasAdminSession(req)) res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  else res.redirect('/login');
});
// 계정관리 페이지 (일반 사용자)
app.get('/account', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

/** =========================
 *  인증 / 사용자
 *  ========================= */
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: '비밀번호 불일치' });
  const adminUser = { id: 'admin', username: 'hwaseonad', email: 'gt.min@hwaseon.com', isAdmin: true };
  req.session.user = adminUser;
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, message: '세션 저장 오류' });
    res.json({ success: true, user: adminUser });
  });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '입력 필요' });

  const usersData = loadUsers();
  const user = (usersData.users || []).find(u => u.username === username);
  if (!user) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  req.session.user = { id: user.id, username: user.username, email: user.email, isAdmin: !!user.isAdmin };
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, message: '세션 저장 오류' });
    res.json({ success: true, user: req.session.user, redirectTo: user.isAdmin ? '/admin' : '/dashboard' });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false, message: '로그아웃 오류' });
    res.json({ success: true, message: '로그아웃 완료' });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) res.json({ success: true, user: req.session.user, isAuthenticated: true });
  else res.status(401).json({ success: false, message: '로그인 필요', isAuthenticated: false });
});

/** =========================
 *  계정관리 API (일반 사용자)
 *  ========================= */

/** 비밀번호 변경 — 현재 비밀번호 검증 후 새 비밀번호 해시 저장 */
app.put('/api/account/password', async (req, res) => {
  // 인증 확인
  if (!req.session.user) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });

  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  // 필수값 검증
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }
  // 새 비밀번호와 확인 비밀번호 일치 검증
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: '새 비밀번호와 확인 비밀번호가 일치하지 않습니다.' });
  }
  // 비밀번호 길이 검증
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: '비밀번호는 8자 이상이어야 합니다.' });
  }

  try {
    const usersData = loadUsers();
    const user = (usersData.users || []).find(u => u.id === req.session.user.id);
    if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    // 현재 비밀번호 검증
    const ok = await bcrypt.compare(currentPassword, user.passwordHash || '');
    if (!ok) return res.status(400).json({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' });

    // 새 비밀번호 해시 + 평문 저장
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordPlain = newPassword;
    if (!saveUsers(usersData)) {
      return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' });
    }
    res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
  } catch (e) {
    console.error('[ACCOUNT PASSWORD FAIL]', e);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' });
  }
});

/** 이메일 변경 — 형식 검증 후 즉시 업데이트 */
app.put('/api/account/email', (req, res) => {
  // 인증 확인
  if (!req.session.user) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });

  const { email } = req.body || {};
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // 이메일 형식 검증
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: '올바른 이메일 형식이 아닙니다.' });
  }

  try {
    const usersData = loadUsers();
    const user = (usersData.users || []).find(u => u.id === req.session.user.id);
    if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    user.email = email;
    if (!saveUsers(usersData)) {
      return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' });
    }

    // 세션 정보도 갱신
    req.session.user.email = email;
    req.session.save(err => {
      if (err) return res.status(500).json({ success: false, message: '세션 저장 오류' });
      res.json({ success: true, message: '이메일이 변경되었습니다.' });
    });
  } catch (e) {
    console.error('[ACCOUNT EMAIL FAIL]', e);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' });
  }
});

/** 내 통계 — 생성한 URL 수, 누적 조회수 합계 */
app.get('/api/account/stats', (req, res) => {
  // 인증 확인
  if (!req.session.user) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });

  try {
    const db = loadDB();
    const userId = req.session.user.id;
    let urlCount = 0;
    let totalVisits = 0;
    for (const code of Object.keys(db)) {
      if (db[code].userId === userId) {
        urlCount++;
        totalVisits += (db[code].totalVisits || 0);
      }
    }
    res.json({ success: true, stats: { urlCount, totalVisits } });
  } catch (e) {
    console.error('[ACCOUNT STATS FAIL]', e);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' });
  }
});

/** 관리자 사용자 목록 */
app.get('/api/admin/auth', (req, res) => {
  res.json({ success: true, isAdmin: !!(req.session?.user?.isAdmin) });
});

app.get('/api/admin/users', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const users = (loadUsers().users || []).map(u => ({
    id: u.id,
    username: u.username,
    passwordPlain: u.passwordPlain || null,
    email: u.email || null,
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt
  }));
  res.json({ success: true, users });
});

/** 사용자 생성 (관리자) */
app.post('/api/admin/users', async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { username, password, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '아이디/비밀번호 필요' });

  const userData = loadUsers();
  if ((userData.users || []).some(u => u.username === username)) {
    return res.status(400).json({ success: false, message: '중복 아이디' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: genId(),
    username,
    passwordHash,
    passwordPlain: password,
    email: email || undefined,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };
  userData.users.push(newUser);
  saveUsers(userData);

  const userResponse = { ...newUser };
  delete userResponse.passwordHash;
  res.json({ success: true, user: userResponse });
});

/** 사용자 수정 (관리자) — username, password 변경 */
app.put('/api/admin/users/:userId', async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { userId } = req.params;
  const { username, password } = req.body || {};

  const data = loadUsers();
  const idx = (data.users || []).findIndex(u => u.id === userId);
  if (idx === -1) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

  const target = data.users[idx];

  if (username && username !== target.username) {
    if (data.users.some(u => u.username === username && u.id !== userId)) {
      return res.status(400).json({ success: false, message: '이미 사용 중인 아이디입니다.' });
    }
    target.username = username;
  }

  if (password) {
    target.passwordHash = await bcrypt.hash(password, 10);
    target.passwordPlain = password;
  }

  saveUsers(data);
  res.json({ success: true });
});

/** 공통 삭제 로직 */
function deleteUserById(userId, sessionUser) {
  const data = loadUsers();
  const users = data.users || [];
  const idx = users.findIndex(u => u.id === userId);

  if (idx === -1) return { ok: false, code: 404, msg: '사용자를 찾을 수 없습니다.' };
  const target = users[idx];

  // 관리자 삭제 방지
  if (target.isAdmin) return { ok: false, code: 400, msg: '관리자 계정은 삭제할 수 없습니다.' };
  // 자기 자신 삭제 방지 (원하면 막기)
  if (sessionUser && sessionUser.id === target.id) {
    return { ok: false, code: 403, msg: '자기 자신의 계정은 삭제할 수 없습니다.' };
  }

  users.splice(idx, 1);
  saveUsers({ users });
  return { ok: true };
}

/** 관리자 삭제 (세션/키 모두 허용) */
app.delete('/api/admin/users/:userId', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { userId } = req.params;
  const result = deleteUserById(userId, req.session.user);
  if (!result.ok) return res.status(result.code).json({ success: false, message: result.msg });
  res.json({ success: true });
});

/** ✅ 호환 라우트: 예전 프론트 호출 지원
 *  - /api/users/:userId + adminKey 지원
 */
app.delete('/api/users/:userId', (req, res) => {
  if (!ensureAdmin(req, res)) return; // 세션 관리자이거나 adminKey 유효해야 함
  const { userId } = req.params;
  const result = deleteUserById(userId, req.session.user);
  if (!result.ok) return res.status(result.code).json({ success: false, message: result.msg });
  res.json({ success: true });
});

/** =========================
 *  URL 단축/조회/삭제
 *  ========================= */
const BASE_URL = process.env.NODE_ENV === 'production'
  ? (process.env.DOMAIN || 'https://hwaseon-url.com')
  : `http://localhost:${PORT}`;

// 허용 도메인 목록 (환경변수 or BASE_URL 폴백)
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim()).filter(Boolean)
  : [new URL(BASE_URL).host];

// 도메인 목록 반환 (프론트 드롭다운용, 인증 불필요)
app.get('/api/domains', (_req, res) => {
  res.json({ domains: ALLOWED_DOMAINS });
});

app.get('/urls', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const db = loadDB();
  const isAdmin = !!req.session.user?.isAdmin;
  const userId = req.session.user?.id || null;

  const baseHost = new URL(BASE_URL).host;
  const urls = Object.keys(db)
    .filter(code => isAdmin || db[code].userId === userId)
    // domain 필드 없는 기존 데이터는 BASE_URL 도메인으로 폴백
    .map(code => ({ ...db[code], shortCode: code, domain: db[code].domain || baseHost }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(urls);
});

app.post('/shorten', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const { url, domain, memo } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL 누락' });
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'http 또는 https URL만 허용됩니다.' });
    }
  } catch {
    return res.status(400).json({ error: '유효하지 않은 URL입니다.' });
  }

  // 선택 도메인 결정: body.domain이 허용목록에 있으면 사용, 없으면 BASE_URL 도메인으로 폴백
  const baseHost = new URL(BASE_URL).host;
  const useSelected = domain && ALLOWED_DOMAINS.includes(domain);
  const selectedDomain = useSelected ? domain : baseHost;

  const db = loadDB();
  let code;
  do { code = generateShortCode(); } while (db[code]);

  // 선택 도메인이 있으면 https로, 없으면 기존 BASE_URL 형식 유지(로컬 http 보존)
  const shortUrl = useSelected ? `https://${selectedDomain}/${code}` : `${BASE_URL}/${code}`;

  db[code] = {
    longUrl: url,
    shortUrl,
    domain: selectedDomain,   // ← 추가
    todayVisits: 0,
    totalVisits: 0,
    createdAt: new Date().toISOString(),
    lastReset: new Date().toISOString(),
    ip: getClientIp(req),
    logs: [],
    userId: req.session.user ? req.session.user.id : null,
    username: req.session.user ? req.session.user.username : '비회원',
    memo: (typeof memo === 'string' ? memo.trim() : '').slice(0, 120)
  };
  saveDB(db);

  res.json({ shortUrl: db[code].shortUrl, shortCode: code });
});

app.delete('/urls/:shortCode', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });

  const userId = req.session.user ? req.session.user.id : null;
  const isAdmin = !!req.session.user?.isAdmin;
  if (!isAdmin && db[code].userId !== userId) return res.status(403).json({ error: '권한 없음' });

  delete db[code];
  saveDB(db);
  res.json({ message: '삭제 완료' });
});

// 선택 삭제 (배치) — 로그인 + 소유권(또는 관리자) 검증
app.post('/urls/batch-delete', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const { codes } = req.body || {};
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: '삭제할 항목이 없습니다.' });
  }

  const db = loadDB();
  const userId = req.session.user.id;
  const isAdmin = !!req.session.user.isAdmin;
  let deleted = 0;
  let skipped = 0;

  for (const code of codes) {
    if (!db[code]) { skipped++; continue; }
    // 권한 없는 항목은 건너뜀
    if (!isAdmin && db[code].userId !== userId) { skipped++; continue; }
    delete db[code];
    deleted++;
  }

  saveDB(db);
  res.json({ success: true, deleted, skipped });
});

// 이슈 1: 메모 수정 — 로그인 + 소유권(또는 관리자) 검증
app.put('/urls/:shortCode', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  if (db[code].userId !== req.session.user.id && !req.session.user.isAdmin) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  db[code].memo = req.body?.memo ?? '';
  saveDB(db);
  res.json({ message: '수정 완료' });
});

/** 상세 — 이슈 2: 로그인 + 소유권(또는 관리자) 검증 */
app.get('/urls/:shortCode/details', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  if (db[code].userId !== req.session.user.id && !req.session.user.isAdmin) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const d = db[code];
  res.json({
    shortCode: code,
    createdAt: d.createdAt,
    ip: d.ip,
    todayVisits: d.todayVisits || 0,
    totalVisits: d.totalVisits || 0,
    dailyLimit: 5000,
    logs: d.logs || []
  });
});

/** 방문 추적 */
app.post('/track/:shortCode', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  db[code].todayVisits = (db[code].todayVisits || 0) + 1;
  db[code].totalVisits = (db[code].totalVisits || 0) + 1;
  saveDB(db);
  res.json({ success: true, todayVisits: db[code].todayVisits, totalVisits: db[code].totalVisits });
});

/** 리다이렉트 */
app.get('/:shortCode', (req, res, next) => {
  const code = req.params.shortCode;
  if (['dashboard', 'multiple', 'login', 'signup', 'admin', 'account'].includes(code) || code.includes('.')) return next();

  const db = loadDB();
  const row = db[code];
  if (!row) return res.status(404).send('잘못된 단축URL');

  const ua = req.headers['user-agent'] || '';
  const isBot = [/bot/i, /spider/i, /crawl/i, /monitor/i, /render/i, /health/i].some(re => re.test(ua));
  if (!isBot) {
    row.todayVisits = (row.todayVisits || 0) + 1;
    row.totalVisits = (row.totalVisits || 0) + 1;
    row.logs ||= [];
    row.logs.unshift({ ip: getClientIp(req), time: new Date().toISOString() });
    if (row.logs.length > 100) row.logs = row.logs.slice(0, 100);
    saveDB(db);
  }

  const target = row.longUrl.startsWith('http') ? row.longUrl : `https://${row.longUrl}`;
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  res.redirect(302, target);
});

/** =========================
 *  전체 삭제
 *  ========================= */
app.delete('/delete-all', (req, res) => {
  const db = loadDB();
  const userId = req.session.user?.id || null;
  const isAdmin = !!req.session.user?.isAdmin;

  if (!userId) return res.status(401).json({ success: false, error: '로그인이 필요합니다' });
  if (isAdmin) {
    saveDB({});
    return res.json({ success: true, message: '모든 URL이 삭제되었습니다.' });
  }
  const filtered = {};
  for (const [code, data] of Object.entries(db)) {
    if (data.userId !== userId) filtered[code] = data;
  }
  saveDB(filtered);
  res.json({ success: true, message: '내 URL이 모두 삭제되었습니다.' });
});

/** =========================
 *  백업/복원
 *  ========================= */
app.get('/api/backup', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const usersData = loadUsers();
  const safeUsers = {
    users: (usersData.users || []).map(u => {
      const { passwordPlain, ...rest } = u;
      return rest;
    })
  };
  const backup = { timestamp: new Date().toISOString(), urls: loadDB(), users: safeUsers };
  res.setHeader('Content-Disposition', `attachment; filename=backup-${new Date().toISOString().slice(0,10)}.json`);
  res.json(backup);
});

app.post('/api/restore', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { urls, users } = req.body || {};
  if (!urls || !users) return res.status(400).json({ success: false, message: '유효하지 않은 백업 데이터' });
  saveDB(urls);
  saveUsers(users);
  res.json({ success: true });
});

/** =========================
 *  크론: 방문 초기화 & 자동 백업
 *  ========================= */
cron.schedule('0 0 * * *', () => {
  const db = loadDB();
  for (const code in db) {
    db[code].todayVisits = 0;
    db[code].lastReset = new Date().toISOString();
  }
  saveDB(db);
  console.log('🕛 방문자 초기화 완료');
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 0 * * *', () => {
  const backup = { timestamp: new Date().toISOString(), urls: loadDB(), users: loadUsers() };
  const file = path.join(BACKUPS_DIR, `backup-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log('✅ 자동 백업 완료:', file);
}, { timezone: 'Asia/Seoul' });

/** =========================
 *  서버 시작
 *  ========================= */
app.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});
