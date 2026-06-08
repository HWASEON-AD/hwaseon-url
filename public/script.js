document.addEventListener('DOMContentLoaded', async function () {

  // ── 로그인 상태 확인 ──
  let currentUser = null;
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: { 'Cache-Control': 'no-cache' } });
    const data = await res.json();
    if (data.success && data.isAuthenticated) currentUser = data.user;
  } catch (_) {}

  if (!currentUser) {
    document.getElementById('guestView').style.display = '';
    return;
  }

  // ── 로그인 상태 렌더 ──
  document.getElementById('userView').style.display = '';
  const statusEl = document.getElementById('loginStatus');
  statusEl.innerHTML = `
    ${currentUser.isAdmin ? '<span class="admin-badge">관리자</span>' : ''}
    <span class="user-name">${currentUser.username}</span>
    <button id="logoutBtn" class="logout-btn">로그아웃</button>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    location.reload();
  });

  // ── 도메인 목록 로드 ──
  try {
    const res = await fetch('/api/domains', { headers: { 'Cache-Control': 'no-cache' } });
    const data = await res.json();
    const sel = document.getElementById('domainSelect');
    if (sel && Array.isArray(data.domains)) {
      sel.innerHTML = data.domains.map(d => `<option value="${d}">${d}</option>`).join('');
    }
  } catch (_) {}

  // ── URL 단축 ──
  const longUrlInput = document.getElementById('longUrl');
  const shortenBtn   = document.getElementById('shortenBtn');
  const resultBox    = document.getElementById('resultBox');
  const shortUrlSpan = document.getElementById('shortUrl');
  const copyBtn      = document.getElementById('copyBtn');

  async function shorten() {
    let url = longUrlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch (_) { showToast('유효한 URL을 입력하세요', 'error'); return; }

    shortenBtn.disabled = true;
    shortenBtn.textContent = '처리중…';

    try {
      const domain = document.getElementById('domainSelect')?.value || '';
      const res = await fetch('/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, domain })
      });
      if (res.status === 401) { location.href = '/login'; return; }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      shortUrlSpan.textContent = data.shortUrl;
      resultBox.style.display = 'flex';
      showToast('단축 완료!');
    } catch (e) {
      showToast('단축 실패: ' + e.message, 'error');
    } finally {
      shortenBtn.disabled = false;
      shortenBtn.textContent = '단축';
    }
  }

  shortenBtn.addEventListener('click', shorten);
  longUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') shorten(); });

  // ── 복사 ──
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shortUrlSpan.textContent)
      .then(() => showToast('복사됐어요!'))
      .catch(() => showToast('복사 실패', 'error'));
  });
});

// ── 토스트 ──
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'copy-notification' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// URL 유효성 검사
function isValidUrl(url) {
  try { return new URL(url).hostname.includes('.'); } catch (_) { return false; }
}
