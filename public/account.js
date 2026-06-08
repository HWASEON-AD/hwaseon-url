// account.js — 계정관리 페이지 클라이언트 로직

// 현재 이메일 값을 보관 (편집 취소 시 복원용)
let currentEmail = '';

// ===== 토스트 알림 (dashboard.js와 동일 패턴) =====
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast-item' + (type === 'error' ? ' toast-item--error' : '');
  el.textContent = msg;
  const container = document.getElementById('toastContainer') || document.body;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// ===== 가입일 포맷 (YYYY. MM. DD.) =====
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;
  } catch (e) {
    console.error('[formatDate 실패]', e);
    return '—';
  }
}

// ===== 사용자 정보 렌더 =====
function renderUser(user) {
  document.getElementById('userName').textContent = user.username || '';
  document.getElementById('accountUsername').textContent = user.username || '';
  currentEmail = user.email || '';
  document.getElementById('emailDisplay').textContent = currentEmail || '(미설정)';
  document.getElementById('accountCreatedAt').textContent = formatDate(user.createdAt);
}

// ===== 통계 로드 =====
function loadStats() {
  fetch('/api/account/stats', { method: 'GET', credentials: 'include' })
    .then(r => {
      if (r.status === 401) { window.location.replace('/login'); throw new Error('unauthorized'); }
      return r.json();
    })
    .then(data => {
      if (!data.success) throw new Error(data.message || '통계 조회 실패');
      const { urlCount, totalVisits } = data.stats;
      document.getElementById('statUrlCount').textContent = (urlCount || 0).toLocaleString();
      document.getElementById('statTotalVisits').textContent = (totalVisits || 0).toLocaleString();
    })
    .catch(err => {
      if (err.message !== 'unauthorized') {
        console.error('[통계 로드 실패]', err);
        showToast('통계를 불러오지 못했습니다.', 'error');
      }
    });
}

// ===== 이메일 인라인 편집 =====
function enterEmailEdit() {
  const input = document.getElementById('emailInput');
  input.value = currentEmail;
  document.getElementById('emailDisplay').style.display = 'none';
  document.getElementById('emailEditBtn').style.display = 'none';
  input.style.display = 'block';
  document.getElementById('emailSaveBtn').style.display = 'inline-flex';
  document.getElementById('emailCancelBtn').style.display = 'inline-flex';
  hideEmailError();
  input.focus();
}

function exitEmailEdit() {
  document.getElementById('emailInput').style.display = 'none';
  document.getElementById('emailSaveBtn').style.display = 'none';
  document.getElementById('emailCancelBtn').style.display = 'none';
  document.getElementById('emailDisplay').style.display = 'inline';
  document.getElementById('emailEditBtn').style.display = 'inline-flex';
  hideEmailError();
}

function showEmailError(msg) {
  const el = document.getElementById('emailError');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideEmailError() {
  document.getElementById('emailError').style.display = 'none';
}

function saveEmail() {
  const input = document.getElementById('emailInput');
  const email = (input.value || '').trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 클라이언트 형식 검증
  if (!emailRegex.test(email)) {
    showEmailError('올바른 이메일 형식이 아닙니다.');
    return;
  }
  hideEmailError();

  fetch('/api/account/email', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
    .then(r => {
      if (r.status === 401) { window.location.replace('/login'); throw new Error('unauthorized'); }
      return r.json().then(data => ({ ok: r.ok, data }));
    })
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        showEmailError(data.message || '이메일 변경에 실패했습니다.');
        return;
      }
      currentEmail = email;
      document.getElementById('emailDisplay').textContent = currentEmail;
      exitEmailEdit();
      showToast('이메일이 변경되었습니다.');
    })
    .catch(err => {
      if (err.message !== 'unauthorized') {
        console.error('[이메일 변경 실패]', err);
        showEmailError('서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
      }
    });
}

// ===== 비밀번호 변경 =====
function showPwError(msg) {
  const el = document.getElementById('pwError');
  el.textContent = msg;
  el.style.display = 'block';
}
function hidePwError() {
  document.getElementById('pwError').style.display = 'none';
}

function submitPasswordChange(e) {
  e.preventDefault();
  hidePwError();

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  // 클라이언트 유효성 검사
  if (!currentPassword || !newPassword || !confirmPassword) {
    showPwError('모든 항목을 입력해주세요.');
    return;
  }
  if (newPassword.length < 8) {
    showPwError('비밀번호는 8자 이상이어야 합니다.');
    return;
  }
  if (newPassword !== confirmPassword) {
    showPwError('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
    return;
  }

  const btn = document.getElementById('pwSubmitBtn');
  btn.disabled = true;

  fetch('/api/account/password', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
  })
    .then(r => {
      if (r.status === 401) { window.location.replace('/login'); throw new Error('unauthorized'); }
      return r.json().then(data => ({ ok: r.ok, data }));
    })
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        showPwError(data.message || '비밀번호 변경에 실패했습니다.');
        return;
      }
      // 성공: 폼 초기화 + 토스트
      document.getElementById('pwForm').reset();
      showToast('비밀번호가 변경되었습니다.');
    })
    .catch(err => {
      if (err.message !== 'unauthorized') {
        console.error('[비밀번호 변경 실패]', err);
        showPwError('서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
      }
    })
    .finally(() => { btn.disabled = false; });
}

// ===== 로그아웃 =====
function logout() {
  fetch('/api/logout', { method: 'POST', credentials: 'include' })
    .then(r => r.json())
    .then(() => window.location.replace('/login'))
    .catch(() => window.location.replace('/login'));
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', function () {
  // 로그인 확인 + 사용자 정보 렌더
  fetch('/api/me', { method: 'GET', credentials: 'include', headers: { 'Cache-Control': 'no-cache' } })
    .then(r => { if (!r.ok) throw new Error('unauthorized'); return r.json(); })
    .then(data => {
      if (!data.success || !data.isAuthenticated) { window.location.replace('/login'); return; }
      renderUser(data.user);
      loadStats();
    })
    .catch(() => window.location.replace('/login'));

  // 이벤트 바인딩
  document.getElementById('emailEditBtn').addEventListener('click', enterEmailEdit);
  document.getElementById('emailSaveBtn').addEventListener('click', saveEmail);
  document.getElementById('emailCancelBtn').addEventListener('click', exitEmailEdit);
  document.getElementById('pwForm').addEventListener('submit', submitPasswordChange);
  document.getElementById('logoutBtn').addEventListener('click', logout);
});
