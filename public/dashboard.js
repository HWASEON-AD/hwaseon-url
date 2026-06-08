// ===== 상태 =====
const PAGE_SIZE = 20;
let allUrls = [];
let currentDomainFilter = 'all';
let currentSearchQuery = '';
let currentPage = 1;

// 도메인별 배지 색상
const DOMAIN_COLORS = {
    'hwaseon-url': '#3b82f6',
    'amos-url':    '#22c55e',
    'prmr-url':    '#a855f7',
    'iope-url':    '#f97316',
    'amore-url':   '#e91e63',
};
function getDomainColor(domain) {
    const d = domain || '';
    const key = Object.keys(DOMAIN_COLORS).find(k => d.includes(k));
    return DOMAIN_COLORS[key] || '#6b7280';
}
function getDomainShort(domain) {
    const d = domain || '';
    return Object.keys(DOMAIN_COLORS).find(k => d.includes(k)) || d;
}

// ===== 유틸 =====
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return safe.replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`); }
    catch { return safe; }
}

// ===== 토스트 =====
function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = 'toast-item' + (type === 'error' ? ' toast-item--error' : '');
    el.textContent = msg;
    const container = document.getElementById('toastContainer') || document.body;
    container.appendChild(el);
    setTimeout(() => el.remove(), 2400);
}

// ===== 도메인 탭 =====
function renderDomainTabs() {
    const el = document.getElementById('domainTabs');
    if (!el) return;
    const counts = {};
    allUrls.forEach(u => { const d = u.domain || ''; counts[d] = (counts[d] || 0) + 1; });
    const domains = Object.keys(counts).sort();
    const tabs = [{ key: 'all', label: `전체 (${allUrls.length})`, color: '#374151' }];
    domains.forEach(d => {
        const short = getDomainShort(d);
        tabs.push({ key: d, label: `${short} (${counts[d]})`, color: getDomainColor(d) });
    });
    el.innerHTML = '';
    tabs.forEach(tab => {
        const active = currentDomainFilter === tab.key;
        const btn = document.createElement('button');
        btn.className = 'domain-tab' + (active ? ' domain-tab--active' : '');
        btn.textContent = tab.label;
        btn.style.setProperty('--tab-color', tab.color);
        btn.onclick = () => { currentDomainFilter = tab.key; currentPage = 1; filterAndRender(); };
        el.appendChild(btn);
    });
}

// ===== 테이블 행 =====
function buildRowHtml(url) {
    const domain = url.domain || '';
    const color = getDomainColor(domain);
    const shortLabel = getDomainShort(domain);
    const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:${color};">${highlight(shortLabel, currentSearchQuery)}</span>`;
    const memo = escapeHtml(url.memo || '');
    const memoDisplay = memo || '<span style="color:#ccc;font-size:12px;">메모 없음</span>';
    const displayUsername = url.username || '비회원';

    return `
        <td style="text-align:center;">
            <button class="btn-copy-small" onclick="copyShort('${escapeHtml(url.shortUrl)}')">복사</button>
        </td>
        <td class="url-cell" style="font-size:12px;">
            <a href="${escapeHtml(url.shortUrl)}" target="_blank" class="url-link">${highlight(url.shortUrl, currentSearchQuery)}</a>
        </td>
        <td class="url-cell" style="font-size:12px;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${highlight(url.longUrl, currentSearchQuery)}</td>
        <td style="text-align:center;">${badge}</td>
        <td style="text-align:center;">${url.todayVisits || 0}</td>
        <td style="text-align:center;">${url.totalVisits || 0}</td>
        <td style="text-align:center;font-size:12px;">${escapeHtml(displayUsername)}</td>
        <td class="memo-cell" data-code="${escapeHtml(url.shortCode)}" onclick="startMemoEdit(this)" title="클릭하여 메모 편집">
            <span class="memo-text">${memoDisplay}</span>
        </td>
        <td style="text-align:center;">
            <button class="delete-btn" onclick="deleteUrl('${escapeHtml(url.shortCode)}')">삭제</button>
        </td>
        <td style="text-align:center;">
            <button class="detail-btn" onclick="showDetails('${escapeHtml(url.shortCode)}')">보기</button>
        </td>
    `;
}

// ===== 메모 인라인 편집 =====
function startMemoEdit(td) {
    if (td.querySelector('input')) return; // 이미 편집 중
    const shortCode = td.dataset.code;
    const currentMemo = td.querySelector('.memo-text')?.innerText.trim();
    const realMemo = (currentMemo === '메모 없음') ? '' : (currentMemo || '');

    td.innerHTML = `<input class="memo-input" type="text" value="${escapeHtml(realMemo)}" placeholder="메모 입력…" maxlength="120" />`;
    const input = td.querySelector('input');
    input.focus();
    input.select();

    async function save() {
        const newMemo = input.value.trim();
        await saveMemo(shortCode, newMemo);
        // 로컬 상태 업데이트
        const idx = allUrls.findIndex(u => u.shortCode === shortCode);
        if (idx !== -1) allUrls[idx].memo = newMemo;
        // 셀 복원
        const display = newMemo
            ? escapeHtml(newMemo)
            : '<span style="color:#ccc;font-size:12px;">메모 없음</span>';
        td.innerHTML = `<span class="memo-text">${display}</span>`;
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
            const old = realMemo
                ? escapeHtml(realMemo)
                : '<span style="color:#ccc;font-size:12px;">메모 없음</span>';
            td.innerHTML = `<span class="memo-text">${old}</span>`;
            input.removeEventListener('blur', save);
        }
    });
}

async function saveMemo(shortCode, memo) {
    try {
        const res = await fetch(`/urls/${shortCode}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ memo })
        });
        if (!res.ok) throw new Error('저장 실패');
        showToast('메모 저장됨');
    } catch (e) {
        showToast('메모 저장 실패', 'error');
    }
}

// ===== 페이지네이션 =====
function renderPagination(total) {
    const el = document.getElementById('pagination');
    if (!el) return;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    let html = '';
    html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goPage(${currentPage - 1})">‹ 이전</button>`;

    // 페이지 번호 버튼 (최대 7개 표시)
    const range = 3;
    let start = Math.max(1, currentPage - range);
    let end   = Math.min(totalPages, currentPage + range);
    if (start > 1) html += `<button class="page-btn" onclick="goPage(1)">1</button>`;
    if (start > 2) html += `<span class="page-ellipsis">…</span>`;
    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn${i === currentPage ? ' page-btn--active' : ''}" onclick="goPage(${i})">${i}</button>`;
    }
    if (end < totalPages - 1) html += `<span class="page-ellipsis">…</span>`;
    if (end < totalPages) html += `<button class="page-btn" onclick="goPage(${totalPages})">${totalPages}</button>`;

    html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goPage(${currentPage + 1})">다음 ›</button>`;
    html += `<span class="page-info">${total}개 중 ${(currentPage-1)*PAGE_SIZE+1}~${Math.min(currentPage*PAGE_SIZE, total)}</span>`;
    el.innerHTML = html;
}

function goPage(n) {
    currentPage = n;
    filterAndRender();
    window.scrollTo(0, 0);
}

// ===== 필터 + 렌더 =====
function filterAndRender() {
    const searchEl = document.getElementById('searchInput');
    const newQuery = searchEl ? searchEl.value.trim() : '';

    // 검색어 변경 시 항상 1페이지로 리셋
    if (newQuery !== currentSearchQuery) {
        currentPage = 1;
    }
    currentSearchQuery = newQuery;

    renderDomainTabs();

    const tbody = document.getElementById('dashboard-tbody');
    if (!tbody) return;

    const q = currentSearchQuery.toLowerCase();
    const filtered = allUrls.filter(url => {
        if (currentDomainFilter !== 'all' && (url.domain || '') !== currentDomainFilter) return false;
        if (!q) return true;
        return [url.longUrl, url.shortUrl, url.memo, url.shortCode, url.domain]
            .some(v => (v || '').toString().toLowerCase().includes(q));
    });

    const totalFiltered = filtered.length;
    const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    tbody.innerHTML = '';
    if (pageItems.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="10" style="text-align:center;padding:28px;color:#aaa;">표시할 URL이 없습니다.</td>`;
        tbody.appendChild(row);
        renderPagination(0);
        return;
    }
    pageItems.forEach(url => {
        const row = document.createElement('tr');
        row.innerHTML = buildRowHtml(url);
        tbody.appendChild(row);
    });

    renderPagination(totalFiltered);
}

function clearSearch() {
    const el = document.getElementById('searchInput');
    if (el) el.value = '';
    currentSearchQuery = '';
    currentPage = 1;
    filterAndRender();
}

// ===== URL 목록 로드 =====
function loadUrls() {
    fetch('/urls', { credentials: 'include', headers: { 'Cache-Control': 'no-cache' } })
        .then(r => {
            if (r.status === 401) { window.location.href = '/login'; return null; }
            if (!r.ok) throw new Error('서버 오류');
            return r.json();
        })
        .then(urls => {
            if (!urls) return;
            allUrls = Array.isArray(urls) ? urls : [];
            currentPage = 1;
            filterAndRender();
        })
        .catch(() => showToast('URL 목록 로드 실패', 'error'));
}

// ===== URL 삭제 =====
function deleteUrl(shortCode) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    fetch(`/urls/${shortCode}`, { method: 'DELETE', credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(); loadUrls(); showToast('삭제됐습니다'); })
        .catch(() => showToast('삭제 실패', 'error'));
}

// ===== 복사 =====
function copyShort(url) {
    navigator.clipboard.writeText(url)
        .then(() => showToast('복사됐어요!'))
        .catch(() => showToast('복사 실패', 'error'));
}
// 하위호환
function copyToClipboard(url) { copyShort(url); }

// ===== 다중 URL 등록 =====
async function openBulkModal() {
    // 도메인 목록 로드
    try {
        const res = await fetch('/api/domains', { credentials: 'include' });
        const data = await res.json();
        const sel = document.getElementById('bulkDomainSelect');
        if (sel && Array.isArray(data.domains)) {
            sel.innerHTML = data.domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
        }
    } catch {}

    document.getElementById('bulkUrlInput').value = '';
    document.getElementById('bulkResult').style.display = 'none';
    document.getElementById('bulkResult').innerHTML = '';
    document.getElementById('bulkModal').style.display = 'flex';
    document.getElementById('bulkUrlInput').focus();
}

async function submitBulkCreate() {
    const raw = document.getElementById('bulkUrlInput').value;
    const domain = document.getElementById('bulkDomainSelect').value;
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) { showToast('URL을 입력하세요', 'error'); return; }

    const btn = document.getElementById('bulkSubmitBtn');
    btn.disabled = true;
    btn.textContent = '등록 중…';

    const resultEl = document.getElementById('bulkResult');
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<div style="color:#888;font-size:13px;">처리 중…</div>';

    const results = [];
    for (const rawUrl of lines) {
        let url = rawUrl;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try {
            const res = await fetch('/shorten', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ url, domain })
            });
            if (res.status === 401) { window.location.href = '/login'; return; }
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            results.push({ ok: true, longUrl: url, shortUrl: data.shortUrl });
        } catch (e) {
            results.push({ ok: false, longUrl: url, error: e.message });
        }
    }

    const okCount = results.filter(r => r.ok).length;
    resultEl.innerHTML = `
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#333;">
            완료: ${okCount}/${results.length}개 등록
        </div>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
            ${results.map(r => `
                <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:4px 6px;color:${r.ok ? '#22c55e' : '#e53935'};font-weight:700;white-space:nowrap;">${r.ok ? '✓' : '✗'}</td>
                    <td style="padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;" title="${escapeHtml(r.longUrl)}">${escapeHtml(r.longUrl)}</td>
                    <td style="padding:4px 6px;white-space:nowrap;">${r.ok ? `<a href="${escapeHtml(r.shortUrl)}" target="_blank" style="color:#3b82f6;">${escapeHtml(r.shortUrl)}</a>` : `<span style="color:#e53935;">${escapeHtml(r.error||'오류')}</span>`}</td>
                </tr>
            `).join('')}
        </table>
    `;

    btn.disabled = false;
    btn.textContent = '등록하기';
    if (okCount > 0) loadUrls();
}

// ===== 상세 정보 =====
function showDetails(shortCode) {
    fetch(`/urls/${shortCode}/details`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(async details => {
            // 기존 상세 모달 제거
            document.querySelectorAll('.detail-modal').forEach(m => m.remove());

            const date = new Date(details.createdAt);
            const formattedDate = date.getFullYear() + '. ' + String(date.getMonth()+1).padStart(2,'0') + '. ' + String(date.getDate()).padStart(2,'0') + '. ' +
                String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0') + ':' + String(date.getSeconds()).padStart(2,'0');
            let ipDisplay = details.ip || 'localhost';
            if (typeof ipDisplay === 'string') ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';

            let logsTable = '';
            if (details.logs && details.logs.length > 0) {
                logsTable = `<table style="width:100%;font-size:12px;text-align:center;"><thead><tr><th>IP</th><th>접속시간</th></tr></thead><tbody>`;
                details.logs.forEach(log => {
                    const t = new Date(log.time).toLocaleString('ko-KR', {year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
                    logsTable += `<tr><td>${escapeHtml(log.ip)}</td><td>${t}</td></tr>`;
                });
                logsTable += '</tbody></table>';
            } else {
                logsTable = '<div style="color:#888;font-size:13px;">접속 기록 없음</div>';
            }

            const modal = document.createElement('div');
            modal.className = 'modal-overlay detail-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="modal-title">단축 도메인 정보: ${escapeHtml(shortCode)}</div>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div style="text-align:right;margin-bottom:10px;">
                        <button id="modal-excel-download-btn" style="padding:7px 22px;font-size:13px;background:#22c55e;color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:inherit;">엑셀 다운로드</button>
                    </div>
                    <div class="detail-grid">
                        <div class="detail-item"><div class="detail-label">생성일 / IP</div><div class="detail-value">${formattedDate}<br>${escapeHtml(ipDisplay)}</div></div>
                        <div class="detail-item"><div class="detail-label">하루 접속허용수</div><div class="detail-value highlight">5,000</div></div>
                        <div class="detail-item"><div class="detail-label">오늘 방문자 수</div><div class="detail-value">${details.todayVisits || 0}</div></div>
                        <div class="detail-item"><div class="detail-label">누적 방문자 수</div><div class="detail-value">${details.totalVisits || 0}</div></div>
                        <div class="detail-item"><div class="detail-label">접속 로그</div><div class="detail-value"><div class="logs-scroll">${logsTable}</div></div></div>
                    </div>
                </div>
            `;
            modal.querySelector('.modal-close').onclick = () => modal.remove();
            modal.onclick = e => { if (e.target === modal) modal.remove(); };
            document.body.appendChild(modal);

            // 상세 엑셀 다운로드
            setTimeout(async () => {
                const excelBtn = document.getElementById('modal-excel-download-btn');
                if (!excelBtn) return;
                let username = '';
                try {
                    const r = await fetch('/api/me', { credentials: 'include' });
                    if (r.ok) { const d = await r.json(); username = d?.user?.username || ''; }
                } catch {}
                let latestDate = (details.logs && details.logs.length > 0)
                    ? details.logs.map(l=>l.time).sort().reverse()[0]
                    : details.createdAt;
                let dateStr = '';
                if (latestDate) {
                    const d = new Date(latestDate);
                    dateStr = `${d.getFullYear().toString().slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                }
                const fileName = `${username||'user'}_${shortCode}_상세${dateStr ? '_'+dateStr : ''}.xlsx`;

                excelBtn.onclick = () => {
                    const dateCount = {};
                    let total = 0;
                    (details.logs||[]).forEach(log => {
                        const d = new Date(log.time);
                        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        dateCount[ds] = (dateCount[ds]||0)+1; total++;
                    });
                    const dateArr = Object.keys(dateCount).sort((a,b)=>b.localeCompare(a));
                    const wsData = [['Short URL','Long URL','생성일','총 방문수','날짜','방문수'],
                        [details.shortUrl||shortCode, details.longUrl||'', formattedDate, total, dateArr[0]||'', dateCount[dateArr[0]]||'']];
                    for (let i=1;i<dateArr.length;i++) wsData.push(['','','','',dateArr[i],dateCount[dateArr[i]]||0]);

                    const ipMap = {};
                    (details.logs||[]).forEach(log => { if (!ipMap[log.ip]) ipMap[log.ip]=[]; ipMap[log.ip].push(log.time); });
                    const wsLogs = [['IP','접속시간','IP별 총 접속수']];
                    Object.entries(ipMap).forEach(([ip, times]) => {
                        const ts = times.sort((a,b)=>b.localeCompare(a)).map(t => {
                            const d = new Date(t);
                            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                        }).join('\n');
                        wsLogs.push([ip, ts, times.length]);
                    });
                    const wb = XLSX.utils.book_new();
                    const ws1 = XLSX.utils.aoa_to_sheet(wsData);
                    const ws2 = XLSX.utils.aoa_to_sheet(wsLogs);
                    ws1['!cols'] = [{wch:30},{wch:50},{wch:22},{wch:12},...dateArr.map(_=>({wch:14}))];
                    ws2['!cols'] = [{wch:18},{wch:44},{wch:12}];
                    XLSX.utils.book_append_sheet(wb, ws1, '상세정보');
                    XLSX.utils.book_append_sheet(wb, ws2, '접속로그');
                    XLSX.writeFile(wb, fileName);
                };
            }, 0);
        })
        .catch(() => showToast('상세 정보 로드 실패', 'error'));
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', function() {
    loadUrls();

    // 전체 삭제
    document.getElementById('deleteAllBtn')?.addEventListener('click', async () => {
        if (!confirm('모든 URL을 삭제하시겠습니까?')) return;
        try {
            const r = await fetch('/delete-all', { method: 'DELETE', credentials: 'include' });
            if (!r.ok) throw new Error();
            loadUrls();
            showToast('전체 삭제됐습니다');
        } catch { showToast('전체 삭제 실패', 'error'); }
    });

    // 엑셀 다운로드
    document.getElementById('downloadExcelBtn')?.addEventListener('click', async () => {
        const loadingModal = document.createElement('div');
        loadingModal.className = 'modal-overlay';
        loadingModal.innerHTML = `<div class="modal-content" style="text-align:center;padding:40px 30px;"><div style="font-size:18px;font-weight:800;">엑셀 다운로드 중…</div><div style="margin-top:12px;color:#888;font-size:14px;">잠시만 기다려주세요</div></div>`;
        document.body.appendChild(loadingModal);

        try {
            const urlRes = await fetch('/urls', { credentials: 'include' });
            if (!urlRes.ok) throw new Error();
            const urls = await urlRes.json();
            if (!Array.isArray(urls) || urls.length === 0) { showToast('다운로드할 데이터가 없습니다', 'error'); return; }

            const dataWithDetails = await Promise.all(urls.map(async url => {
                try {
                    const dr = await fetch(`/urls/${url.shortCode}/details`, { credentials: 'include' });
                    if (!dr.ok) throw new Error();
                    const d = await dr.json();
                    return { ...url, ip: d.ip||'', createdAt: d.createdAt||'', logs: d.logs||[] };
                } catch { return { ...url, ip:'', createdAt:'', logs:[] }; }
            }));

            const wsDash = [['Short URL','Long URL','메모','오늘 방문','누적 방문','생성일','도메인','사용자']];
            const wsDetail = [['Short URL','Long URL','생성일/IP','접속 IP','접속시간']];
            const dateSet = new Set();
            const urlDateCount = {};

            dataWithDetails.forEach(item => {
                let fd = '';
                if (item.createdAt) {
                    const d = new Date(item.createdAt);
                    fd = `${d.getFullYear()}. ${String(d.getMonth()+1).padStart(2,'0')}. ${String(d.getDate()).padStart(2,'0')}. ` +
                         `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                }
                let ipDisplay = item.ip || '';
                if (ipDisplay) ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';

                wsDash.push([item.shortUrl, item.longUrl, item.memo||'', item.todayVisits, item.totalVisits, fd, getDomainShort(item.domain), item.username||'비회원']);

                urlDateCount[item.shortUrl] = {};
                (item.logs||[]).forEach(log => {
                    const d = new Date(log.time);
                    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    dateSet.add(ds);
                    urlDateCount[item.shortUrl][ds] = (urlDateCount[item.shortUrl][ds]||0)+1;
                    const lt = new Date(log.time).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
                    wsDetail.push([item.shortUrl, item.longUrl, `${fd} ${ipDisplay}`, log.ip, lt]);
                });
                if (!(item.logs||[]).length) wsDetail.push([item.shortUrl, item.longUrl, `${fd} ${ipDisplay}`, '-', '-']);
            });

            const dateArr = Array.from(dateSet).sort((a,b)=>b.localeCompare(a));
            const wsDate = [['Short URL','Long URL','총 조회수',...dateArr]];
            dataWithDetails.forEach(item => {
                let total = 0;
                dateArr.forEach(d => { total += (urlDateCount[item.shortUrl]?.[d]||0); });
                wsDate.push([item.shortUrl, item.longUrl, total, ...dateArr.map(d => urlDateCount[item.shortUrl]?.[d]||0)]);
            });

            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.aoa_to_sheet(wsDash);
            ws1['!cols'] = [{wch:30},{wch:50},{wch:24},{wch:10},{wch:10},{wch:22},{wch:14},{wch:12}];
            const ws2 = XLSX.utils.aoa_to_sheet(wsDetail);
            ws2['!cols'] = [{wch:30},{wch:50},{wch:32},{wch:20},{wch:22}];
            const ws3 = XLSX.utils.aoa_to_sheet(wsDate);
            ws3['!cols'] = [{wch:30},{wch:50},{wch:10},...dateArr.map(_=>({wch:12}))];
            XLSX.utils.book_append_sheet(wb, ws1, 'URL 대시보드');
            XLSX.utils.book_append_sheet(wb, ws2, '상세보기');
            XLSX.utils.book_append_sheet(wb, ws3, '날짜별 방문자수');
            XLSX.writeFile(wb, 'url_list.xlsx');
        } catch { showToast('엑셀 다운로드 실패', 'error'); }
        finally { loadingModal.remove(); }
    });

    // 다중 URL 등록
    document.getElementById('bulkCreateBtn')?.addEventListener('click', openBulkModal);
    document.getElementById('bulkSubmitBtn')?.addEventListener('click', submitBulkCreate);

    // 모달 외부 클릭 닫기
    document.getElementById('bulkModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('bulkModal'))
            document.getElementById('bulkModal').style.display = 'none';
    });
});
