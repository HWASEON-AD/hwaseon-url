// scripts/migrate.js
// 사용법: node scripts/migrate.js <소스db.json> <도메인명>
// 예: node scripts/migrate.js ./amos_db.json amos-url.onrender.com
//
// 동작:
//  1. 현재 db.json 읽기 (없으면 db_merged.json, 둘 다 없으면 빈 객체)
//  2. 소스 파일의 각 shortCode가 현재 db에 없으면 추가 + domain 세팅
//  3. shortCode 충돌 시 스킵 + 콘솔 로그
//  4. db_merged.json 으로 저장 (원본 db.json 은 건드리지 않음)
//  5. 추가 N건 / 충돌 M건 출력

const fs = require('fs');
const path = require('path');

const [, , srcFile, domain] = process.argv;

// 인자 검증
if (!srcFile || !domain) {
  console.error('[오류] 사용법: node scripts/migrate.js <소스db.json> <도메인명>');
  console.error('  예: node scripts/migrate.js ./amos_db.json amos-url.onrender.com');
  process.exit(1);
}

// JSON 안전 읽기
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[읽기 실패] ${file}:`, e.message);
    return fallback;
  }
}

// 소스 파일 로드
const srcPath = path.resolve(srcFile);
if (!fs.existsSync(srcPath)) {
  console.error(`[오류] 소스 파일을 찾을 수 없습니다: ${srcPath}`);
  process.exit(1);
}
const srcDb = readJSON(srcPath, null);
if (!srcDb || typeof srcDb !== 'object') {
  console.error(`[오류] 소스 파일이 유효한 JSON 객체가 아닙니다: ${srcPath}`);
  process.exit(1);
}

// 현재 통합 대상 db 로드 (db_merged.json 우선, 없으면 db.json)
const mergedFile = path.resolve('./db_merged.json');
const baseFile = path.resolve('./db.json');
let targetDb;
if (fs.existsSync(mergedFile)) {
  targetDb = readJSON(mergedFile, {});
  console.log(`[정보] 기존 db_merged.json 을 기준으로 병합합니다.`);
} else {
  targetDb = readJSON(baseFile, {});
  console.log(`[정보] db.json 을 기준으로 병합합니다. (없으면 빈 객체)`);
}

// 병합
let added = 0;
let conflict = 0;
for (const [code, data] of Object.entries(srcDb)) {
  if (targetDb[code]) {
    conflict++;
    console.log(`[충돌 스킵] shortCode '${code}' 는 이미 존재합니다.`);
    continue;
  }
  // domain 필드 강제 세팅 (소스에 이미 있어도 인자값으로 덮어씀)
  targetDb[code] = { ...data, domain };
  added++;
}

// 저장
try {
  fs.writeFileSync(mergedFile, JSON.stringify(targetDb, null, 2));
} catch (e) {
  console.error(`[저장 실패] ${mergedFile}:`, e.message);
  process.exit(1);
}

console.log('==============================');
console.log(`소스 파일 : ${srcPath}`);
console.log(`도메인    : ${domain}`);
console.log(`추가      : ${added}건`);
console.log(`충돌 스킵 : ${conflict}건`);
console.log(`전체 항목 : ${Object.keys(targetDb).length}건`);
console.log(`저장 위치 : ${mergedFile}`);
console.log('==============================');
