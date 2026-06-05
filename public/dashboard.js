// ===== 멀티도메인: 전역 상태 & 헬퍼 =====
// 도메인별 배지 색상
const DOMAIN_COLORS = {
    'hwaseon-url': '#3b82f6', // 파랑
    'amos-url': '#22c55e',    // 초록
    'prmr-url': '#a855f7',    // 보라
    'iope-url': '#f97316',    // 주황
};
function getDomainColor(domain) {
    const d = domain || '';
    const key = Object.keys(DOMAIN_COLORS).find(k => d.includes(k));
    return DOMAIN_COLORS[key] || '#6b7280'; // 기타 회색
}

let allUrls = [];                 // 서버에서 받은 전체 URL 목록
let currentDomainFilter = 'all';  // 현재 도메인 탭
let currentSearchQuery = '';      // 현재 검색어

// 검색어 하이라이트
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return safe.replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`);
    } catch { return safe; }
}

// 도메인 탭 렌더링 (전체 + 도메인별, 개수 표시)
function renderDomainTabs() {
    const tabsEl = document.getElementById('domainTabs');
    if (!tabsEl) return;

    // 도메인별 개수 집계
    const counts = {};
    allUrls.forEach(u => {
        const d = u.domain || '';
        counts[d] = (counts[d] || 0) + 1;
    });
    const domains = Object.keys(counts).sort();

    const tabs = [{ key: 'all', label: `전체 (${allUrls.length})`, color: '#374151' }];
    domains.forEach(d => {
        // 표시용 라벨: 'amos-url.onrender.com' → 'amos-url'
        const short = (Object.keys(DOMAIN_COLORS).find(k => d.includes(k))) || d;
        tabs.push({ key: d, label: `${short} (${counts[d]})`, color: getDomainColor(d) });
    });

    tabsEl.innerHTML = '';
    tabs.forEach(tab => {
        const active = currentDomainFilter === tab.key;
        const btn = document.createElement('button');
        btn.textContent = tab.label;
        btn.style.cssText = `padding:6px 12px; border-radius:16px; cursor:pointer; font-size:13px;`
            + ` border:1px solid ${tab.color};`
            + (active ? ` background:${tab.color}; color:#fff;` : ` background:#fff; color:${tab.color};`);
        btn.onclick = () => {
            currentDomainFilter = tab.key;
            filterAndRender();
        };
        tabsEl.appendChild(btn);
    });
}

// 한 행 HTML 생성 (검색어 하이라이트 포함)
function buildRowHtml(url) {
    let displayUsername = '비회원';
    if (url.username) displayUsername = url.username;
    const domain = url.domain || '';
    const color = getDomainColor(domain);
    const shortLabel = (Object.keys(DOMAIN_COLORS).find(k => domain.includes(k))) || domain;
    const badge = `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:12px; color:#fff; background:${color};">${highlight(shortLabel, currentSearchQuery)}</span>`;
    return `
        <td class="action-cell" style="width: 5%; text-align: center;">
            <button class="copy-btn" onclick="copyToClipboard('${url.shortUrl}')" style="padding: 4px 8px; background-color: #1877f2; color: white; border: none; border-radius: 4px; cursor: pointer;">복사</button>
        </td>
        <td class="url-cell" style="width: 15%; text-align: center;">
            <a href="${url.shortUrl}" target="_blank" class="url-link">${highlight(url.shortUrl, currentSearchQuery)}</a>
        </td>
        <td class="url-cell" style="width: 27%; text-align: center;">${highlight(url.longUrl, currentSearchQuery)}</td>
        <td class="domain-cell" style="width: 11%; text-align: center;">${badge}</td>
        <td class="visits-cell" style="width: 8%; text-align: center;">${url.todayVisits || 0}</td>
        <td class="visits-cell" style="width: 8%; text-align: center;">${url.totalVisits || 0}</td>
        <td class="user-cell" style="width: 10%; text-align: center;">${displayUsername}</td>
        <td class="action-cell" style="width: 7%; text-align: center;">
            <button class="delete-btn" onclick="deleteUrl('${url.shortCode}')">삭제</button>
        </td>
        <td class="action-cell" style="width: 7%; text-align: center;">
            <button class="detail-btn" onclick="showDetails('${url.shortCode}')">보기</button>
        </td>
    `;
}

// 도메인 탭 + 검색어 필터 적용 후 테이블 렌더
function filterAndRender() {
    const searchEl = document.getElementById('searchInput');
    currentSearchQuery = searchEl ? searchEl.value.trim() : '';

    renderDomainTabs();

    const tbody = document.getElementById('dashboard-tbody');
    if (!tbody) return;

    const q = currentSearchQuery.toLowerCase();
    const filtered = allUrls.filter(url => {
        // 도메인 탭 필터
        if (currentDomainFilter !== 'all' && (url.domain || '') !== currentDomainFilter) return false;
        // 검색어 필터 (longUrl, memo, shortCode, domain)
        if (!q) return true;
        return [url.longUrl, url.memo, url.shortCode, url.domain]
            .some(v => (v || '').toString().toLowerCase().includes(q));
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="9" style="text-align: center; padding: 20px;">표시할 URL이 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }
    filtered.forEach(url => {
        const row = document.createElement('tr');
        row.innerHTML = buildRowHtml(url);
        tbody.appendChild(row);
    });
}

// 검색 지우기
function clearSearch() {
    const searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
    currentSearchQuery = '';
    filterAndRender();
}

// URL 목록 로드
function loadUrls() {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;

    console.log('URL 목록 로드 시도');
        
    fetch(`${baseUrl}/urls`, {
        method: 'GET',
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        credentials: 'include' // 세션 쿠키 포함
    })
        .then(response => {
            console.log('URL 목록 응답 상태:', response.status);
            if (!response.ok) {
                if (response.status === 401) {
                    // 로그인이 필요한 경우
                    console.log('인증되지 않음, 로그인 페이지로 이동');
                    window.location.href = '/login';
                    return;
                }
                throw new Error('서버 응답 오류');
            }
            return response.json();
        })
        .then(urls => {
            console.log('URL 목록 수신 완료:', urls ? urls.length : 0);
            // 전역 저장 후 도메인 탭 + 검색 필터 적용하여 렌더
            allUrls = Array.isArray(urls) ? urls : [];
            filterAndRender();
        })
        .catch(error => {
            console.error('Error:', error);
            alert('URL 목록을 불러오는 중 오류가 발생했습니다.');
        });
}

// URL 삭제
function deleteUrl(shortCode) {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;
        
    if (confirm('정말 삭제하시겠습니까?')) {
        fetch(`${baseUrl}/urls/${shortCode}`, {
            method: 'DELETE',
            credentials: 'include' // 세션 쿠키 포함
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('삭제 실패');
            }
            loadUrls();
        })
        .catch(error => {
            console.error('Error:', error);
            alert('URL 삭제 중 오류가 발생했습니다.');
        });
    }
}

// 상세 정보 표시
function showDetails(shortCode) {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;
    
    fetch(`${baseUrl}/urls/${shortCode}/details`, {
        credentials: 'include' // 세션 쿠키 포함
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('상세 정보 조회 실패');
            }
            return response.json();
        })
        .then(async details => {
            // 기존 모달이 있다면 제거
            const existingModal = document.querySelector('.modal-overlay');
            if (existingModal) {
                existingModal.remove();
            }
            // 날짜 포맷팅
            const date = new Date(details.createdAt);
            const formattedDate = date.getFullYear() + '. ' + String(date.getMonth()+1).padStart(2,'0') + '. ' + String(date.getDate()).padStart(2,'0') + '. ' +
                String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0') + ':' + String(date.getSeconds()).padStart(2,'0');
            // IP 괄호로 한 줄(맨 앞 IP만)
            let ipDisplay = details.ip || 'localhost';
            if (ipDisplay && typeof ipDisplay === 'string') {
                ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';
            }
            // logs 표 생성
            let logsTable = '';
            if (details.logs && details.logs.length > 0) {
                logsTable = `<table style="width:100%;margin-top:10px;font-size:13px;text-align:center;"><thead><tr><th style='text-align:center;'>IP</th><th style='text-align:center;'>접속시간</th></tr></thead><tbody>`;
                details.logs.forEach(log => {
                    const t = new Date(log.time).toLocaleString('ko-KR', {year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
                    logsTable += `<tr><td style='text-align:center;'>${log.ip}</td><td style='text-align:center;'>${t}</td></tr>`;
                });
                logsTable += '</tbody></table>';
            } else {
                logsTable = '<div style="color:#888;font-size:13px;">접속 기록 없음</div>';
            }
            // 모달 생성
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="modal-title">단축 도메인 정보: ${shortCode}</div>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div style="text-align:right;margin-bottom:10px;">
                        <button id="modal-excel-download-btn" style="padding:7px 22px;font-size:1.05rem;background:#19c37d;color:#fff;border:none;border-radius:7px;cursor:pointer;">엑셀 다운로드</button>
                    </div>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <div class="detail-label">생성일 / IP</div>
                            <div class="detail-value">${formattedDate} <br>${ipDisplay}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">하루 접속허용수</div>
                            <div class="detail-value highlight">5,000</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">오늘 방문자 수</div>
                            <div class="detail-value">${details.todayVisits || 0}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">누적 방문자 수</div>
                            <div class="detail-value">${details.totalVisits || 0}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">접속 로그</div>
                            <div class="detail-value"><div class="logs-scroll">${logsTable}</div></div>
                        </div>
                    </div>
                </div>
            `;
            // 모달 닫기 이벤트
            modal.querySelector('.modal-close').addEventListener('click', () => {
                modal.remove();
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
            document.body.appendChild(modal);

            // 엑셀 다운로드 버튼 이벤트 바인딩
            setTimeout(async () => {
                const excelBtn = document.getElementById('modal-excel-download-btn');
                if (excelBtn) {
                    // 아이디 정보 가져오기
                    let username = '';
                    try {
                        const res = await fetch('/api/me', { credentials: 'include' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data && data.success && data.user && data.user.username) {
                                username = data.user.username;
                            }
                        }
                    } catch {}
                    // 최신 방문일 구하기 (logs가 있으면 가장 최신, 없으면 생성일)
                    let latestDate = '';
                    if (details.logs && details.logs.length > 0) {
                        const sorted = details.logs.map(l => l.time).sort().reverse();
                        latestDate = sorted[0] || '';
                    } else {
                        latestDate = details.createdAt;
                    }
                    let dateStr = '';
                    if (latestDate) {
                        const d = new Date(latestDate);
                        dateStr = `${d.getFullYear().toString().slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                    }
                    // 파일명: 아이디_단축코드_상세_날짜.xlsx
                    let fileName = `${username || 'user'}_${shortCode}_상세`;
                    if (dateStr) fileName += `_${dateStr}`;
                    fileName += '.xlsx';

                    excelBtn.onclick = async function() {
                        // longUrl을 전체 목록에서 찾아서 보장
                        let longUrlVal = details.longUrl;
                        if (!longUrlVal) {
                            try {
                                const baseUrl = window.location.origin;
                                const urlRes = await fetch(`${baseUrl}/urls`, { credentials: 'include' });
                                if (urlRes.ok) {
                                    const urls = await urlRes.json();
                                    const found = Array.isArray(urls) ? urls.find(u => u.shortCode === shortCode) : null;
                                    if (found && found.longUrl) longUrlVal = found.longUrl;
                                }
                            } catch {}
                        }
                        if (!longUrlVal) longUrlVal = '없음';
                        if (Array.isArray(longUrlVal)) longUrlVal = longUrlVal[0] || '없음';
                        if (typeof longUrlVal === 'string') longUrlVal = longUrlVal.replace(/\n/g, '').replace(/[\r\n]+/g, '');
                        // Short URL 보장
                        let shortUrlVal = details.shortUrl;
                        if (!shortUrlVal && shortCode) {
                            shortUrlVal = window.location.origin + '/' + shortCode;
                        }
                        // 1. 날짜별 방문수 집계 (내림차순)
                        const dateCount = {};
                        let total = 0;
                        if (details.logs && details.logs.length > 0) {
                            details.logs.forEach(log => {
                                const d = new Date(log.time);
                                const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;
                                total++;
                            });
                        }
                        // 날짜 내림차순
                        const dateArr = Object.keys(dateCount).sort((a, b) => b.localeCompare(a));
                        // 첫 시트: 상세정보 (기본정보 가로, 날짜/방문수 세로가 총 방문수 오른쪽에)
                        const wsData = [
                            ['Short URL', 'Long URL', '생성일', '총 방문수', '날짜', '방문수'],
                            [shortUrlVal, longUrlVal, formattedDate, total, dateArr[0] || '', dateCount[dateArr[0]] || ''],
                        ];
                        for (let i = 1; i < dateArr.length; i++) {
                            wsData.push(['', '', '', '', dateArr[i], dateCount[dateArr[i]] || 0]);
                        }
                        // 두 번째 시트: 중복 IP 하나만, 접속시간 모두 줄바꿈, 총 접속수
                        const ipMap = {};
                        if (details.logs && details.logs.length > 0) {
                            details.logs.forEach(log => {
                                if (!ipMap[log.ip]) ipMap[log.ip] = [];
                                ipMap[log.ip].push(log.time);
                            });
                        }
                        const wsLogs = [
                            ['IP', '접속시간', 'IP별 총 접속수']
                        ];
                        Object.entries(ipMap).forEach(([ip, times]) => {
                            // 접속시간 내림차순
                            const sortedTimes = times.sort((a, b) => b.localeCompare(a));
                            const timeStr = sortedTimes.map(t => {
                                const d = new Date(t);
                                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ` +
                                    `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                            }).join('\n');
                            wsLogs.push([ip, timeStr, times.length]);
                        });
                        // 워크북 생성
                        const wb = XLSX.utils.book_new();
                        const ws1 = XLSX.utils.aoa_to_sheet(wsData);
                        const ws2 = XLSX.utils.aoa_to_sheet(wsLogs);
                        // 시트 컬럼 너비 넓게 설정
                        ws1['!cols'] = [
                            { wch: 30 }, // Short URL
                            { wch: 50 }, // Long URL
                            { wch: 22 }, // 생성일
                            { wch: 12 }, // 총 방문수
                            ...dateArr.map(_ => ({ wch: 14 }))
                        ];
                        ws2['!cols'] = [
                            { wch: 18 }, // IP
                            { wch: 44 }, // 접속시간
                            { wch: 12 }  // IP별 총 접속수
                        ];
                        XLSX.utils.book_append_sheet(wb, ws1, '상세정보');
                        XLSX.utils.book_append_sheet(wb, ws2, '접속로그');
                        XLSX.writeFile(wb, fileName);
                    };
                }
            }, 0);
        })
        .catch(error => {
            console.error('Error:', error);
            alert('상세 정보를 불러오는 중 오류가 발생했습니다.');
        });
}

// 페이지 로드 시 URL 목록 로드
document.addEventListener('DOMContentLoaded', function() {
    // 로그인 상태 확인
    checkLoginStatus();
    
    // 전체 삭제 버튼 이벤트 리스너
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async function() {
            if (!confirm('모든 URL을 삭제하시겠습니까?')) return;
            try {
                // 현재 도메인 기반으로 설정
                const baseUrl = window.location.origin;
                    
                const response = await fetch(`${baseUrl}/delete-all`, { 
                    method: 'DELETE',
                    credentials: 'include' // 세션 쿠키 포함
                });
                if (!response.ok) throw new Error('전체 삭제 실패');
                loadUrls();
                alert('모든 URL이 삭제되었습니다.');
            } catch (e) {
                alert('전체 삭제 중 오류가 발생했습니다.');
            }
        });
    }

    // 엑셀 다운로드 버튼 이벤트 리스너
    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    if (downloadExcelBtn) {
        downloadExcelBtn.addEventListener('click', async function() {
            // 1. 로딩 모달 표시
            const loadingModal = document.createElement('div');
            loadingModal.className = 'modal-overlay';
            loadingModal.innerHTML = `
                <div class="modal-content" style="text-align:center;padding:40px 30px;min-width:260px;">
                    <div style="font-size:20px;font-weight:bold;color:#1877f2;">엑셀 다운로드 중...</div>
                    <div style="margin-top:18px;color:#888;font-size:15px;">잠시만 기다려주세요</div>
                </div>
            `;
            document.body.appendChild(loadingModal);
            try {
                // 현재 도메인 기반으로 설정
                const baseUrl = window.location.origin;
                // 1. 전체 URL 목록 가져오기
                const urlRes = await fetch(`${baseUrl}/urls`, {
                    credentials: 'include' // 세션 쿠키 포함
                });
                if (!urlRes.ok) throw new Error('URL 목록 조회 실패');
                const urls = await urlRes.json();
                if (!Array.isArray(urls) || urls.length === 0) {
                    alert('다운로드할 데이터가 없습니다.');
                    loadingModal.remove();
                    return;
                }
                // 2. 각 URL의 상세 정보(IP 등) 병합
                const dataWithDetails = await Promise.all(urls.map(async url => {
                    try {
                        const detailRes = await fetch(`${baseUrl}/urls/${url.shortCode}/details`, {
                            credentials: 'include' // 세션 쿠키 포함
                        });
                        if (!detailRes.ok) throw new Error();
                        const details = await detailRes.json();
                        return {
                            ...url,
                            ip: details.ip || '',
                            createdAt: details.createdAt || '',
                            logs: details.logs || []
                        };
                    } catch {
                        return { ...url, ip: '', createdAt: '', logs: [] };
                    }
                }));
                // 3. 엑셀 데이터 생성 (시트 1: URL 대시보드)
                const wsDataDashboard = [
                    ['Short URL', 'Long URL', '오늘 방문', '누적 방문', '생성일 / IP']
                ];
                // 3. 엑셀 데이터 생성 (시트 2: 상세보기)
                const wsDataDetail = [
                    ['Short URL', 'Long URL', '생성일 / IP', '접속 IP', '접속시간']
                ];
                // 3. 날짜별 방문자수 시트 데이터 준비
                // 1) 날짜 집계용 객체
                const dateSet = new Set();
                const urlDateCount = {};
                dataWithDetails.forEach(item => {
                    // 생성일/ IP (맨 앞 IP만)
                    let formattedDate = '';
                    if (item.createdAt) {
                        const date = new Date(item.createdAt);
                        formattedDate = `${date.getFullYear()}. ${String(date.getMonth()+1).padStart(2,'0')}. ${String(date.getDate()).padStart(2,'0')}. ` +
                            `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
                    }
                    let ipDisplay = item.ip || '';
                    if (ipDisplay && typeof ipDisplay === 'string') {
                        ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';
                    }
                    const dateIp = `${formattedDate} ${ipDisplay}`;

                    // URL 대시보드 시트 한 줄
                    wsDataDashboard.push([
                        item.shortUrl,
                        item.longUrl,
                        item.todayVisits,
                        item.totalVisits,
                        dateIp
                    ]);

                    // 상세보기 시트: 모든 로그를 개별 행으로 표시
                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const logIp = log.ip;
                            const logTime = new Date(log.time).toLocaleString('ko-KR', {
                                year: '2-digit',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                            wsDataDetail.push([
                                item.shortUrl,
                                item.longUrl,
                                dateIp,
                                logIp,
                                logTime
                            ]);
                        });
                    } else {
                        wsDataDetail.push([
                            item.shortUrl,
                            item.longUrl,
                            dateIp,
                            '-',
                            '-'
                        ]);
                    }
                    // 날짜별 방문자수 집계
                    urlDateCount[item.shortUrl] = {};
                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const d = new Date(log.time);
                            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                            dateSet.add(dateStr);
                            urlDateCount[item.shortUrl][dateStr] = (urlDateCount[item.shortUrl][dateStr] || 0) + 1;
                        });
                    }
                });
                // 날짜 배열을 반드시 wsDataDate 생성 전에 선언
                const dateArr = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
                // 3) 시트 데이터 헤더
                const wsDataDate = [['Short URL', 'Long URL', '총 조회수', ...dateArr]];
                // 4) 각 URL별로 날짜별 방문자수 행 생성
                dataWithDetails.forEach(item => {
                    const row = [item.shortUrl, item.longUrl];
                    // 총 조회수 계산
                    let total = 0;
                    dateArr.forEach(date => {
                        total += (urlDateCount[item.shortUrl][date] || 0);
                    });
                    row.push(total);
                    dateArr.forEach(date => {
                        row.push(urlDateCount[item.shortUrl][date] || 0);
                    });
                    wsDataDate.push(row);
                });
                // 기존 시트 생성 및 워크북에 추가
                const wsDashboard = XLSX.utils.aoa_to_sheet(wsDataDashboard);
                wsDashboard['!cols'] = [
                    { wch: 30 }, // Short URL
                    { wch: 50 }, // Long URL
                    { wch: 10 }, // 오늘 방문
                    { wch: 10 }, // 누적 방문
                    { wch: 32 }  // 생성일 / IP
                ];
                // 헤더 스타일 적용 (보라색 계열 배경, 흰색 글씨, 굵은 글씨)
                const dashboardHeader = ['A1','B1','C1','D1','E1'];
                dashboardHeader.forEach(cell => {
                    if(wsDashboard[cell]) {
                        wsDashboard[cell].s = {
                            fill: { fgColor: { rgb: '7D5FFF' } },
                            font: { color: { rgb: 'FFFFFF' }, bold: true },
                            alignment: { horizontal: 'center', vertical: 'center' }
                        };
                    }
                });
                const wsDetail = XLSX.utils.aoa_to_sheet(wsDataDetail);
                wsDetail['!cols'] = [
                    { wch: 30 }, // Short URL
                    { wch: 50 }, // Long URL
                    { wch: 32 }, // 생성일 / IP
                    { wch: 40 }, // 접속 IP
                    { wch: 22 }  // 접속시간
                ];
                // 헤더 스타일 적용 (보라색 계열 배경, 흰색 글씨, 굵은 글씨)
                const detailHeader = ['A1','B1','C1','D1','E1'];
                detailHeader.forEach(cell => {
                    if(wsDetail[cell]) {
                        wsDetail[cell].s = {
                            fill: { fgColor: { rgb: '7D5FFF' } },
                            font: { color: { rgb: 'FFFFFF' }, bold: true },
                            alignment: { horizontal: 'center', vertical: 'center' }
                        };
                    }
                });
                // 날짜별 방문자수 시트 생성
                const wsDate = XLSX.utils.aoa_to_sheet(wsDataDate);
                wsDate['!cols'] = [
                    { wch: 30 }, // Short URL
                    { wch: 50 }, // Long URL
                    { wch: 10 }, // 총 조회수
                    ...dateArr.map(_ => ({ wch: 12 }))
                ];
                // 헤더 스타일 적용 (보라색 계열 배경, 흰색 글씨, 굵은 글씨)
                const dateHeader = ['A1', 'B1', 'C1', ...dateArr.map((_,i)=>String.fromCharCode(66+i)+'1')];
                dateHeader.forEach(cell => {
                    if(wsDate[cell]) {
                        wsDate[cell].s = {
                            fill: { fgColor: { rgb: '7D5FFF' } },
                            font: { color: { rgb: 'FFFFFF' }, bold: true },
                            alignment: { horizontal: 'center', vertical: 'center' }
                        };
                    }
                });
                // 2. 유저별 상세 시트 (IP별 방문수, 방문시각)
                const userMap = {};
                dataWithDetails.forEach(item => {
                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const key = log.ip;
                            if (!userMap[key]) userMap[key] = { ip: log.ip, visits: [] };
                            userMap[key].visits.push(log.time);
                        });
                    }
                });
                const userSheet = [
                    ['IP', '유저 방문수', '방문 시각(시:분:초)']
                ];
                Object.values(userMap).forEach(row => {
                    const visitTimes = row.visits.map(t => {
                        const d = new Date(t);
                        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' +
                            String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
                    }).join('\n');
                    userSheet.push([
                        row.ip,
                        row.visits.length,
                        visitTimes
                    ]);
                });
                // 워크북 생성 및 시트 추가
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, wsDashboard, 'URL 대시보드');
                XLSX.utils.book_append_sheet(wb, wsDetail, '상세보기');
                XLSX.utils.book_append_sheet(wb, wsDate, '날짜별 방문자수');
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(userSheet), '유저별 상세'); // 유저별 상세 시트 추가
                XLSX.writeFile(wb, 'url_list.xlsx');
            } catch (e) {
                console.error('엑셀 다운로드 중 JS 에러:', e);
                alert('엑셀 다운로드 중 오류가 발생했습니다.');
            } finally {
                // 2. 로딩 모달 제거
                const modal = document.querySelector('.modal-overlay');
                if (modal) modal.remove();
            }
        });
    }
});

// 로그인 상태 확인 함수
function checkLoginStatus() {
    const baseUrl = window.location.origin;
    
    console.log('로그인 상태 확인 중...');
    
    fetch(`${baseUrl}/api/me`, {
        method: 'GET',
        credentials: 'include', // 세션 쿠키 포함
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    })
    .then(response => {
        if (!response.ok) {
            if (response.status === 401) {
                console.error('인증되지 않음, 로그인 페이지로 이동');
                window.location.href = '/login';
                return null;
            }
            throw new Error('서버 응답 오류');
        }
        return response.json();
    })
    .then(data => {
        if (data && data.success && data.user) {
            console.log('인증된 사용자:', data.user.username);
            // 로그인 성공, URL 목록 로드
            loadUrls();
        } else if (data !== null) {
            console.error('사용자 정보가 없음, 로그인 페이지로 이동');
            window.location.href = '/login';
        }
    })
    .catch(error => {
        console.error('로그인 상태 확인 오류:', error);
        // 오류 발생 시도 로그인 페이지로 이동
        window.location.href = '/login';
    });
}

// 클립보드에 복사하는 함수
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // 복사 성공 알림 표시
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '90%';
        notification.style.left = '50%';
        notification.style.transform = 'translate(-50%, -50%)';
        notification.style.padding = '15px 25px';
        notification.style.backgroundColor = '#28a745';
        notification.style.color = 'white';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '1000';
        notification.style.textAlign = 'center';
        notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        notification.textContent = 'URL이 복사되었습니다!';
        
        document.body.appendChild(notification);
        
        // 1.5초 후 알림 제거 (중앙에 표시되므로 시간을 좀 더 짧게 조정)
        setTimeout(() => {
            notification.remove();
        }, 1500);
    }).catch(err => {
        console.error('클립보드 복사 실패:', err);
        alert('URL 복사에 실패했습니다.');
    });
} 