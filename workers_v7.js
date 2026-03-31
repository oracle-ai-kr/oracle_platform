// ============================================================
//  ORACLE Workers v7
//  v6 기능 유지 + DART OpenAPI 연동 추가
//
//  환경변수:
//  APISPORTS_KEY = "API-Football 키"
//  DART_KEY      = "DART OpenAPI 인증키 (40자리)"
//  ORACLE_KV     = KV Namespace 바인딩
// ============================================================

const ALLOWED_ORIGINS = [
  'https://oracle-ai-kr.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// API-Sports 호스트
const APISPORTS_HOST = 'v3.football.api-sports.io';
const CURRENT_SEASON = 2025;

// 리그 ID 매핑
const LEAGUE_IDS = {
  'K리그1': 292, 'K리그2': 293,
  'EPL': 39, '분데스리가': 78,
  '라리가': 140, '세리에A': 135, '리그앙': 61,
};

// DART OpenAPI
const DART_BASE = 'https://opendart.fss.or.kr/api';

// 리그별 시즌 매핑 (유럽은 2024-25 → 2024, K리그는 2025)
const LEAGUE_SEASON = {
  'K리그1': 2025, 'K리그2': 2025,
  'EPL': 2024, '분데스리가': 2024,
  '라리가': 2024, '세리에A': 2024, '리그앙': 2024,
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const isLocal = !origin || origin === 'null';
    const isAllowed = isLocal || ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o));
    if (!isAllowed) return json({ error: 'Forbidden origin' }, 403);

    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/proxy') return handleGenericProxy(request, url, origin);
      if (path === '/fundamental') return handleFundamental(request, url, origin);
      if (path === '/fundamental-deep') return handleFundamentalDeep(request, url, origin);
      if (path.startsWith('/kis/')) return handleKisProxy(request, url, origin);

      // ★ v6 추가: TOTO API-Football 연동
      if (path === '/toto/standings') return handleTotoStandings(request, url, origin, env);
      if (path === '/toto/h2h') return handleTotoH2H(request, url, origin, env);
      if (path === '/toto/form') return handleTotoForm(request, url, origin, env);
      if (path === '/toto/fixtures') return handleTotoFixtures(request, url, origin, env);
      if (path === '/toto/debug') return handleTotoDebug(request, url, origin, env);

      // ★ v7 추가: DART OpenAPI 연동
      if (path === '/dart/corpcode') return handleDartCorpCode(request, url, origin, env);
      if (path === '/dart/company') return handleDartCompany(request, url, origin, env);
      if (path === '/dart/finance') return handleDartFinance(request, url, origin, env);
      if (path === '/dart/disclosure') return handleDartDisclosure(request, url, origin, env);
      if (path === '/dart/debug') return handleDartDebug(request, url, origin, env);

      // ★ v7 추가: Upbit 프록시 (CORS 우회)
      if (path === '/upbit/market-all') return handleUpbitMarketAll(request, url, origin, env);
      if (path === '/upbit/ticker') return handleUpbitTicker(request, url, origin);

      if (path === '/' || path === '/health') return json({ status: 'ok', version: 'v7', ts: Date.now() });
      return json({ error: 'Not Found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Internal Error' }, 500);
    }
  }
};

// ============================================================
//  ★ TOTO 핸들러들 (v6 신규)
// ============================================================

// ── /toto/standings?league=K리그1 ──
async function handleTotoStandings(request, url, origin, env) {
  const leagueName = url.searchParams.get('league');
  const leagueId = LEAGUE_IDS[leagueName];
  if (!leagueId) return json({ error: '알 수 없는 리그: ' + leagueName }, 400, origin);
  const season = LEAGUE_SEASON[leagueName] || 2024;

  // KV 캐시 확인 (24시간)
  const cacheKey = `toto_standings_${leagueId}_${season}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }

  const data = await apiSportsCall(`/standings?league=${leagueId}&season=${season}`, env.APISPORTS_KEY);
  const teams = parseStandings(data);
  const response = JSON.stringify({ teams, league: leagueName, season, ts: Date.now() });

  // 24시간 캐시
  if (env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, response, { expirationTtl: 86400 });

  return new Response(response, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// ── /toto/h2h?home=ID&away=ID ──
async function handleTotoH2H(request, url, origin, env) {
  const homeId = url.searchParams.get('home');
  const awayId = url.searchParams.get('away');
  if (!homeId || !awayId) return json({ error: 'home, away 파라미터 필요' }, 400, origin);

  const cacheKey = `toto_h2h_${homeId}_${awayId}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }

  const data = await apiSportsCall(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`, env.APISPORTS_KEY);
  const h2h = parseH2H(data, homeId, awayId);
  const response = JSON.stringify({ h2h, ts: Date.now() });

  // 7일 캐시
  if (env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, response, { expirationTtl: 604800 });

  return new Response(response, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// ── /toto/form?team=ID&league=292 ──
async function handleTotoForm(request, url, origin, env) {
  const teamId = url.searchParams.get('team');
  const leagueId = url.searchParams.get('league') || '292';
  if (!teamId) return json({ error: 'team 파라미터 필요' }, 400, origin);

  const cacheKey = `toto_form_${teamId}_${leagueId}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }

  const data = await apiSportsCall(
    `/fixtures?team=${teamId}&league=${leagueId}&season=${CURRENT_SEASON}&last=5&status=FT`,
    env.APISPORTS_KEY
  );
  const form = parseForm(data, teamId);
  const response = JSON.stringify({ form, ts: Date.now() });

  // 6시간 캐시
  if (env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, response, { expirationTtl: 21600 });

  return new Response(response, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// ── /toto/fixtures?league=K리그1 ──
async function handleTotoFixtures(request, url, origin, env) {
  const leagueName = url.searchParams.get('league');
  const leagueId = LEAGUE_IDS[leagueName];
  if (!leagueId) return json({ error: '알 수 없는 리그' }, 400, origin);

  const data = await apiSportsCall(
    `/fixtures?league=${leagueId}&season=${CURRENT_SEASON}&next=10`,
    env.APISPORTS_KEY
  );

  const fixtures = (data?.response || []).map(f => ({
    id: f.fixture?.id,
    date: f.fixture?.date,
    home: { id: f.teams?.home?.id, name: f.teams?.home?.name },
    away: { id: f.teams?.away?.id, name: f.teams?.away?.name },
    status: f.fixture?.status?.short,
  }));

  return new Response(JSON.stringify({ fixtures, ts: Date.now() }), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

// ── /toto/debug — API 응답 원본 확인용 ──
async function handleTotoDebug(request, url, origin, env) {
  const apiKey = env.APISPORTS_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'APISPORTS_KEY 환경변수 없음' }), {
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }

  // /status 엔드포인트로 API 키 유효성 확인
  const statusRes = await fetch('https://v3.football.api-sports.io/status', {
    headers: { 'x-apisports-key': apiKey }
  });
  const statusData = await statusRes.json();

  // EPL standings 원본 응답 확인
  const standingsRes = await fetch('https://v3.football.api-sports.io/standings?league=39&season=2024', {
    headers: { 'x-apisports-key': apiKey }
  });
  const standingsRaw = await standingsRes.json();

  return new Response(JSON.stringify({
    apiKeyPresent: !!apiKey,
    statusCode: statusRes.status,
    statusData,
    standingsCode: standingsRes.status,
    standingsResponseCount: standingsRaw?.results || 0,
    standingsFirstItem: standingsRaw?.response?.[0]?.league?.name || '없음',
    standingsRawKeys: standingsRaw?.response?.[0] ? Object.keys(standingsRaw.response[0]) : [],
  }, null, 2), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

// ── API-Sports 호출 헬퍼 ──
async function apiSportsCall(endpoint, apiKey) {
  if (!apiKey) throw new Error('APISPORTS_KEY 환경변수가 설정되지 않았습니다');
  const res = await fetch(`https://${APISPORTS_HOST}${endpoint}`, {
    headers: {
      'x-apisports-key': apiKey,
    }
  });
  if (!res.ok) throw new Error(`API-Sports 오류: ${res.status}`);
  return res.json();
}

// ── 순위 데이터 파싱 ──
function parseStandings(data) {
  // API-Football 실제 응답: response[0].league.standings[0] (배열의 배열)
  const leagueStandings = data?.response?.[0]?.league?.standings;
  // standings는 [[팀1, 팀2, ...]] 형태 (그룹이 여러개면 [그룹1[], 그룹2[]])
  const standings = Array.isArray(leagueStandings)
    ? (Array.isArray(leagueStandings[0]) ? leagueStandings[0] : leagueStandings)
    : [];
  return standings.map((item, i) => {
    const team = item.team;
    const all = item.all;
    const played = all.played || 1;
    const wins = all.win || 0;
    const draws = all.draw || 0;
    const goalsFor = all.goals?.for || 0;
    const goalsAgainst = all.goals?.against || 0;
    const formStr = item.form || 'WDWDW';
    const form = formStr.slice(-5).split('').map(f => f === 'W' ? 'W' : f === 'D' ? 'D' : 'L');
    const power = Math.round(clampVal(
      (wins / played) * 60 + (goalsFor / played) * 8 - (goalsAgainst / played) * 5 + 40, 40, 98
    ));
    return {
      id: team.id,
      name: team.name,
      rank: item.rank || i + 1,
      power,
      homeWin: clampVal(wins / played + 0.05, 0.2, 0.8),
      awayWin: clampVal((wins / played) * 0.7, 0.1, 0.65),
      form: form.length === 5 ? form : ['W','D','W','D','W'],
      goalsFor: Array(5).fill(Math.round(goalsFor / played * 10) / 10),
      goalsAgainst: Array(5).fill(Math.round(goalsAgainst / played * 10) / 10),
      style: inferStyle(wins, draws, goalsFor, goalsAgainst, played),
      concedePct: clampVal(goalsAgainst / played / 3, 0.1, 0.6),
      earlyGoal: 0.5,
      lateGoal: 0.5,
    };
  });
}

// ── H2H 파싱 ──
function parseH2H(data, homeId, awayId) {
  const fixtures = data?.response || [];
  let homeW = 0, awayW = 0, draws = 0;
  const matches = [];
  fixtures.slice(0, 10).forEach(f => {
    const hGoals = f.goals?.home ?? 0;
    const aGoals = f.goals?.away ?? 0;
    const isHome = String(f.teams?.home?.id) === String(homeId);
    let result;
    if (hGoals === aGoals) { result = 'D'; draws++; }
    else if (hGoals > aGoals) { result = isHome ? 'H' : 'A'; isHome ? homeW++ : awayW++; }
    else { result = isHome ? 'A' : 'H'; isHome ? awayW++ : homeW++; }
    if (matches.length < 5) {
      matches.push({
        result,
        homeGoal: isHome ? hGoals : aGoals,
        awayGoal: isHome ? aGoals : hGoals,
        season: f.league?.season || 2024,
      });
    }
  });
  return { homeW, draws, awayW, matches };
}

// ── 폼 파싱 ──
function parseForm(data, teamId) {
  const fixtures = data?.response || [];
  return fixtures.slice(0, 5).map(f => {
    const hId = String(f.teams?.home?.id);
    const hGoals = f.goals?.home ?? 0;
    const aGoals = f.goals?.away ?? 0;
    const isHome = hId === String(teamId);
    const myGoals = isHome ? hGoals : aGoals;
    const opGoals = isHome ? aGoals : hGoals;
    if (myGoals === opGoals) return 'D';
    return myGoals > opGoals ? 'W' : 'L';
  }).reverse();
}

// ── 전술 스타일 추론 ──
function inferStyle(wins, draws, goalsFor, goalsAgainst, played) {
  const atkRate = goalsFor / played;
  const defRate = goalsAgainst / played;
  const drawRate = draws / played;
  if (drawRate > 0.35) return 'defense';
  if (atkRate > 2.0) return 'press';
  if (defRate < 0.8) return 'counter';
  return 'balanced';
}

function clampVal(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

// ============================================================
//  ★ DART OpenAPI 핸들러들 (v7 신규)
// ============================================================

// ── /dart/corpcode?stock_code=005930 ──
// 종목코드(6자리) → DART 고유번호(8자리) 변환
// corpCode.xml ZIP을 다운로드해서 KV에 매핑 테이블 캐싱 (30일)
async function handleDartCorpCode(request, url, origin, env) {
  const stockCode = url.searchParams.get('stock_code');
  if (!stockCode) return json({ error: 'stock_code 파라미터 필요' }, 400, origin);
  const dartKey = env.DART_KEY;
  if (!dartKey) return json({ error: 'DART_KEY 환경변수 없음' }, 500, origin);

  // KV에서 매핑 테이블 조회
  const mapKey = 'dart_corpcode_map';
  let corpMap = null;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(mapKey);
    if (cached) corpMap = JSON.parse(cached);
  }

  // 매핑 테이블이 없으면 DART에서 다운로드
  if (!corpMap) {
    corpMap = await fetchCorpCodeMap(dartKey);
    if (env.ORACLE_KV && corpMap) {
      // 30일 캐시 (corpCode는 거의 안 바뀜)
      await env.ORACLE_KV.put(mapKey, JSON.stringify(corpMap), { expirationTtl: 2592000 });
    }
  }

  if (!corpMap) return json({ error: 'corpCode 매핑 테이블 로드 실패' }, 502, origin);

  const result = corpMap[stockCode];
  if (!result) return json({ error: '해당 종목코드 없음: ' + stockCode, hint: '상장사만 조회 가능' }, 404, origin);

  return new Response(JSON.stringify({ stock_code: stockCode, ...result, ts: Date.now() }), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

// DART API 공통 fetch 헤더 (봇 차단 우회)
const DART_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

// corpCode.xml ZIP 다운로드 → {종목코드: {corp_code, corp_name}} 매핑
async function fetchCorpCodeMap(dartKey) {
  try {
    const zipUrl = `${DART_BASE}/corpCode.xml?crtfc_key=${dartKey}`;
    const resp = await fetch(zipUrl, { headers: DART_HEADERS, redirect: 'follow' });
    if (!resp.ok) throw new Error(`DART corpCode ZIP: ${resp.status} (url: ${resp.url})`);
    const ct = resp.headers.get('content-type') || '';
    // 리다이렉트로 HTML 에러 페이지가 온 경우 감지
    if (ct.includes('text/html')) throw new Error('DART가 HTML 반환 (봇 차단 또는 키 오류)');
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 100) throw new Error(`ZIP 크기 비정상: ${buf.byteLength} bytes`);

    // ZIP 파싱 (corpCode.xml은 단일 파일 ZIP)
    const zipData = new Uint8Array(buf);
    const xmlStr = await extractXmlFromZip(zipData);
    if (!xmlStr) throw new Error('ZIP에서 XML 추출 실패');

    // XML → 매핑 테이블 (상장사만 = stock_code가 있는 것)
    const map = {};
    // <list>...</list> 블록 단위로 추출 (태그 순서/추가 태그 무관)
    const listRegex = /<list>([\s\S]*?)<\/list>/g;
    let block;
    while ((block = listRegex.exec(xmlStr)) !== null) {
      const inner = block[1];
      const corpCodeM = inner.match(/<corp_code>\s*(\d{8})\s*<\/corp_code>/);
      const corpNameM = inner.match(/<corp_name>\s*([^<]+?)\s*<\/corp_name>/);
      const stockCodeM = inner.match(/<stock_code>\s*(\S+?)\s*<\/stock_code>/);
      if (corpCodeM && corpNameM && stockCodeM) {
        const sc = stockCodeM[1].trim();
        if (sc.length === 6 && /^\d{6}$/.test(sc)) {
          map[sc] = { corp_code: corpCodeM[1], corp_name: corpNameM[1].trim() };
        }
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch (e) {
    console.error('fetchCorpCodeMap error:', e.message);
    return null;
  }
}

// 간이 ZIP 파서 — 단일 파일 ZIP에서 첫 번째 파일 추출 (Deflate + Store 지원)
// Data Descriptor 방식 (compressedSize=0 in local header) 지원
async function extractXmlFromZip(zipData) {
  try {
    // Local file header: PK\x03\x04
    if (zipData[0] !== 0x50 || zipData[1] !== 0x4B) return null;
    const compression = zipData[8] | (zipData[9] << 8);
    let compressedSize = zipData[18] | (zipData[19] << 8) | (zipData[20] << 16) | (zipData[21] << 24);
    const filenameLen = zipData[26] | (zipData[27] << 8);
    const extraLen = zipData[28] | (zipData[29] << 8);
    const dataOffset = 30 + filenameLen + extraLen;

    // compressedSize가 0이면 Central Directory에서 찾기
    if (compressedSize === 0) {
      for (let i = zipData.length - 4; i >= dataOffset; i--) {
        if (zipData[i] === 0x50 && zipData[i+1] === 0x4B && zipData[i+2] === 0x05 && zipData[i+3] === 0x06) {
          const cdOffset = zipData[i+16] | (zipData[i+17] << 8) | (zipData[i+18] << 16) | (zipData[i+19] << 24);
          if (cdOffset > dataOffset && cdOffset < zipData.length) {
            if (zipData[cdOffset] === 0x50 && zipData[cdOffset+1] === 0x4B && zipData[cdOffset+2] === 0x01 && zipData[cdOffset+3] === 0x02) {
              compressedSize = zipData[cdOffset+20] | (zipData[cdOffset+21] << 8) | (zipData[cdOffset+22] << 16) | (zipData[cdOffset+23] << 24);
            }
            if (compressedSize === 0) compressedSize = cdOffset - dataOffset;
          }
          break;
        }
      }
      if (compressedSize === 0) compressedSize = zipData.length - dataOffset;
    }

    const compressedData = zipData.slice(dataOffset, dataOffset + compressedSize);

    if (compression === 0) {
      return new TextDecoder('utf-8').decode(compressedData);
    } else if (compression === 8) {
      // Deflate — 여러 포맷 시도
      const formats = ['deflate-raw', 'raw', 'deflate'];
      for (const fmt of formats) {
        try {
          const ds = new DecompressionStream(fmt);
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const text = await new Response(ds.readable).text();
          if (text && text.length > 0) return text;
        } catch (_) { /* 다음 포맷 시도 */ }
      }
    }
    return null;
  } catch (e) {
    console.error('extractXmlFromZip error:', e.message);
    return null;
  }
}

// ── /dart/company?stock_code=005930 ──
// 기업개황: 대표자, 설립일, 업종, 주소 등
async function handleDartCompany(request, url, origin, env) {
  const stockCode = url.searchParams.get('stock_code');
  if (!stockCode) return json({ error: 'stock_code 파라미터 필요' }, 400, origin);
  const dartKey = env.DART_KEY;
  if (!dartKey) return json({ error: 'DART_KEY 환경변수 없음' }, 500, origin);

  // stock_code → corp_code 변환
  const corp = await resolveCorpCode(stockCode, env, dartKey);
  if (!corp) return json({ error: '종목코드 → 고유번호 변환 실패: ' + stockCode }, 404, origin);

  // KV 캐시 (7일)
  const cacheKey = `dart_company_${corp.corp_code}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }

  const apiUrl = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_code=${corp.corp_code}`;
  const resp = await fetch(apiUrl, { headers: DART_HEADERS });
  const data = await resp.json();

  if (data.status !== '000') return json({ error: data.message || 'DART API 오류', status: data.status }, 400, origin);

  const result = JSON.stringify({
    stock_code: stockCode,
    corp_code: corp.corp_code,
    corp_name: data.corp_name,
    corp_name_eng: data.corp_name_eng,
    ceo: data.ceo_nm,
    corp_cls: data.corp_cls,       // Y:유가 K:코스닥 N:코넥스 E:기타
    establishment: data.est_dt,     // 설립일
    acc_month: data.acc_mt,         // 결산월
    industry_code: data.induty_code,
    address: data.adres,
    homepage: data.hm_url,
    phone: data.phn_no,
    ts: Date.now()
  });

  if (env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, result, { expirationTtl: 604800 });

  return new Response(result, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// ── /dart/finance?stock_code=005930&year=2024&report=annual ──
// 단일회사 주요 재무제표
// report: annual(사업보고서), half(반기), q1(1분기), q3(3분기)
async function handleDartFinance(request, url, origin, env) {
  const stockCode = url.searchParams.get('stock_code');
  if (!stockCode) return json({ error: 'stock_code 파라미터 필요' }, 400, origin);
  const dartKey = env.DART_KEY;
  if (!dartKey) return json({ error: 'DART_KEY 환경변수 없음' }, 500, origin);

  const year = url.searchParams.get('year') || String(new Date().getFullYear() - 1);
  const reportType = url.searchParams.get('report') || 'annual';
  const reprtCode = ({ annual: '11011', half: '11012', q1: '11013', q3: '11014' })[reportType] || '11011';

  const corp = await resolveCorpCode(stockCode, env, dartKey);
  if (!corp) return json({ error: '종목코드 → 고유번호 변환 실패: ' + stockCode }, 404, origin);

  // KV 캐시 (24시간 — 재무제표는 분기마다 업데이트)
  const cacheKey = `dart_finance_${corp.corp_code}_${year}_${reprtCode}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }

  const apiUrl = `${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${dartKey}&corp_code=${corp.corp_code}&bsns_year=${year}&reprt_code=${reprtCode}`;
  const resp = await fetch(apiUrl, { headers: DART_HEADERS });
  const data = await resp.json();

  if (data.status !== '000') return json({ error: data.message || 'DART 재무제표 조회 실패', status: data.status, hint: `${year}년 ${reportType} 보고서가 아직 제출되지 않았을 수 있음` }, 400, origin);

  // 주요 계정 파싱
  const items = (data.list || []).map(item => ({
    sj: item.sj_nm,                // 재무제표구분 (재무상태표/손익계산서 등)
    account: item.account_nm,       // 계정명
    current: item.thstrm_amount,    // 당기금액
    previous: item.frmtrm_amount,   // 전기금액
    beforePrev: item.bfefrmtrm_amount, // 전전기금액
    currency: item.currency,
  }));

  const result = JSON.stringify({
    stock_code: stockCode,
    corp_code: corp.corp_code,
    corp_name: corp.corp_name,
    year, report: reportType, reprt_code: reprtCode,
    items,
    ts: Date.now()
  });

  if (env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, result, { expirationTtl: 86400 });

  return new Response(result, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// ── /dart/disclosure?stock_code=005930&bgn_de=20250101&end_de=20250324&pblntf_ty=A ──
// 공시검색 (캐시 없음 — 실시간 조회)
async function handleDartDisclosure(request, url, origin, env) {
  const stockCode = url.searchParams.get('stock_code');
  const dartKey = env.DART_KEY;
  if (!dartKey) return json({ error: 'DART_KEY 환경변수 없음' }, 500, origin);

  // stock_code가 있으면 corp_code로 변환, 없으면 전체 검색
  let corpCode = '';
  if (stockCode) {
    const corp = await resolveCorpCode(stockCode, env, dartKey);
    if (!corp) return json({ error: '종목코드 → 고유번호 변환 실패: ' + stockCode }, 404, origin);
    corpCode = corp.corp_code;
  }

  // 날짜 기본값: 최근 1개월
  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - 30 * 86400000);
  const bgnDe = url.searchParams.get('bgn_de') || formatDate(oneMonthAgo);
  const endDe = url.searchParams.get('end_de') || formatDate(now);
  const pblntfTy = url.searchParams.get('pblntf_ty') || '';  // A:정기 B:주요사항 C:발행 D:지분 등
  const pageCount = url.searchParams.get('page_count') || '20';
  const pageNo = url.searchParams.get('page_no') || '1';

  let apiUrl = `${DART_BASE}/list.json?crtfc_key=${dartKey}&bgn_de=${bgnDe}&end_de=${endDe}&page_count=${pageCount}&page_no=${pageNo}&sort=date&sort_mth=desc`;
  if (corpCode) apiUrl += `&corp_code=${corpCode}`;
  if (pblntfTy) apiUrl += `&pblntf_ty=${pblntfTy}`;

  const resp = await fetch(apiUrl, { headers: DART_HEADERS });
  const data = await resp.json();

  if (data.status !== '000') {
    if (data.status === '013') return json({ disclosures: [], total_count: 0, message: '조회된 데이터 없음', ts: Date.now() }, 200, origin);
    return json({ error: data.message || 'DART 공시검색 실패', status: data.status }, 400, origin);
  }

  const disclosures = (data.list || []).map(item => ({
    corp_name: item.corp_name,
    corp_code: item.corp_code,
    stock_code: item.stock_code,
    report_nm: item.report_nm,
    rcept_no: item.rcept_no,
    flr_nm: item.flr_nm,           // 공시 제출인
    rcept_dt: item.rcept_dt,        // 접수일자
    rm: item.rm,                    // 비고 (유:유가 코:코스닥 등)
    // DART 원문 링크
    dart_url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
  }));

  return new Response(JSON.stringify({
    disclosures,
    total_count: data.total_count || 0,
    total_page: data.total_page || 0,
    page_no: data.page_no || 1,
    ts: Date.now()
  }), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

// ── DART 공통 헬퍼 ──

// 종목코드 → corp_code 변환 (KV 캐싱 활용)
async function resolveCorpCode(stockCode, env, dartKey) {
  // 개별 키 캐시 확인 (빠른 경로)
  const individualKey = `dart_corp_${stockCode}`;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(individualKey);
    if (cached) return JSON.parse(cached);
  }

  // 전체 매핑 테이블에서 조회
  const mapKey = 'dart_corpcode_map';
  let corpMap = null;
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(mapKey);
    if (cached) corpMap = JSON.parse(cached);
  }

  if (!corpMap) {
    corpMap = await fetchCorpCodeMap(dartKey);
    if (env.ORACLE_KV && corpMap) {
      await env.ORACLE_KV.put(mapKey, JSON.stringify(corpMap), { expirationTtl: 2592000 });
    }
  }

  if (!corpMap || !corpMap[stockCode]) return null;

  const result = corpMap[stockCode];
  // 개별 키도 캐시 (30일)
  if (env.ORACLE_KV) {
    await env.ORACLE_KV.put(individualKey, JSON.stringify(result), { expirationTtl: 2592000 });
  }
  return result;
}

function formatDate(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

// ── /dart/debug — ZIP 다운로드+파싱 디버그 ──
async function handleDartDebug(request, url, origin, env) {
  const dartKey = env.DART_KEY;
  const info = { dartKeyPresent: !!dartKey, dartKeyLen: dartKey ? dartKey.length : 0 };

  if (!dartKey) return new Response(JSON.stringify(info, null, 2), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });

  try {
    const zipUrl = `${DART_BASE}/corpCode.xml?crtfc_key=${dartKey}`;
    const resp = await fetch(zipUrl, { headers: DART_HEADERS });
    info.zipStatus = resp.status;
    info.zipContentType = resp.headers.get('content-type');
    info.zipContentLength = resp.headers.get('content-length');

    if (!resp.ok) {
      info.error = 'ZIP 다운로드 실패';
      return new Response(JSON.stringify(info, null, 2), {
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    const buf = await resp.arrayBuffer();
    info.bufferSize = buf.byteLength;
    const zipData = new Uint8Array(buf);
    info.firstBytes = Array.from(zipData.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    info.isPK = zipData[0] === 0x50 && zipData[1] === 0x4B;

    if (info.isPK) {
      const compression = zipData[8] | (zipData[9] << 8);
      const compressedSize = zipData[18] | (zipData[19] << 8) | (zipData[20] << 16) | (zipData[21] << 24);
      const filenameLen = zipData[26] | (zipData[27] << 8);
      const extraLen = zipData[28] | (zipData[29] << 8);
      info.compression = compression;
      info.compressedSize = compressedSize;
      info.filenameLen = filenameLen;
      info.extraLen = extraLen;
      info.filename = new TextDecoder().decode(zipData.slice(30, 30 + filenameLen));
      info.dataOffset = 30 + filenameLen + extraLen;

      // EOCD 탐색 디버그
      for (let i = zipData.length - 4; i >= 0; i--) {
        if (zipData[i] === 0x50 && zipData[i+1] === 0x4B && zipData[i+2] === 0x05 && zipData[i+3] === 0x06) {
          info.eocdOffset = i;
          const cdOffset = zipData[i+16] | (zipData[i+17] << 8) | (zipData[i+18] << 16) | (zipData[i+19] << 24);
          info.cdOffset = cdOffset;
          info.resolvedCompressedSize = cdOffset - info.dataOffset;
          if (cdOffset < zipData.length) {
            info.cdSignature = Array.from(zipData.slice(cdOffset, cdOffset + 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            if (zipData[cdOffset] === 0x50 && zipData[cdOffset+1] === 0x4B && zipData[cdOffset+2] === 0x01 && zipData[cdOffset+3] === 0x02) {
              info.cdCompressedSize = zipData[cdOffset+20] | (zipData[cdOffset+21] << 8) | (zipData[cdOffset+22] << 16) | (zipData[cdOffset+23] << 24);
            }
          }
          break;
        }
      }

      try {
        const xmlStr = await extractXmlFromZip(zipData);
        info.xmlExtracted = !!xmlStr;
        info.xmlLength = xmlStr ? xmlStr.length : 0;
        if (xmlStr) {
          info.xmlSample = xmlStr.substring(0, 500);
          // 매핑 테스트
          const listRegex = /<list>([\s\S]*?)<\/list>/g;
          let count = 0, samsungFound = false;
          let block;
          while ((block = listRegex.exec(xmlStr)) !== null) {
            const inner = block[1];
            const corpCodeM = inner.match(/<corp_code>\s*(\d{8})\s*<\/corp_code>/);
            const stockCodeM = inner.match(/<stock_code>\s*(\S+?)\s*<\/stock_code>/);
            if (corpCodeM && stockCodeM) {
              const sc = stockCodeM[1].trim();
              if (sc.length === 6 && /^\d{6}$/.test(sc)) {
                count++;
                if (sc === '005930') {
                  samsungFound = true;
                  const nameM = inner.match(/<corp_name>\s*([^<]+?)\s*<\/corp_name>/);
                  info.samsung = { corp_code: corpCodeM[1], corp_name: nameM ? nameM[1].trim() : '' };
                }
              }
            }
          }
          info.mappedStocks = count;
          info.samsungFound = samsungFound;
        }
      } catch (e) {
        info.xmlError = e.message;
      }
    }
  } catch (e) {
    info.fetchError = e.message;
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

// ============================================================
//  ★ Upbit 프록시 핸들러 (v7 신규)
// ============================================================

// ── /upbit/market-all — 전체 마켓 목록 (KV 캐시 24시간)
async function handleUpbitMarketAll(request, url, origin, env) {
  const cacheKey = 'upbit_market_all';
  if (env.ORACLE_KV) {
    const cached = await env.ORACLE_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
  }
  const resp = await fetch('https://api.upbit.com/v1/market/all?isDetails=false', {
    method: 'GET', headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow'
  });
  const body = await resp.text();
  if (resp.ok && env.ORACLE_KV) await env.ORACLE_KV.put(cacheKey, body, { expirationTtl: 86400 });
  return new Response(body, { status: resp.status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
}

// ── /upbit/ticker?markets=KRW-BTC,KRW-ETH,... — 시세 조회
async function handleUpbitTicker(request, url, origin) {
  const markets = url.searchParams.get('markets');
  if (!markets) return json({ error: 'markets 파라미터 필요' }, 400, origin);
  const targetUrl = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(targetUrl, {
        method: 'GET', headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow'
      });
      const body = await resp.text();
      if (resp.ok) return new Response(body, { status: resp.status, headers: { ...corsHeaders(origin), 'Content-Type': resp.headers.get('Content-Type') || 'application/json' } });
      lastErr = `Upbit ticker: ${resp.status}`;
    } catch (e) { lastErr = e.message; }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  }
  return json({ error: 'Upbit ticker proxy failed', detail: lastErr || 'unknown' }, 502, origin);
}

// ============================================================
//  기존 v5 핸들러들 (변경 없음)
// ============================================================

async function handleFundamentalDeep(request, url, origin) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return json({ error: 'Missing ticker param' }, 400, origin);
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`;
  let html;
  try {
    const resp = await fetch(yahooUrl, { headers: YF_HEADERS, redirect: 'follow' });
    if (!resp.ok) return json({ error: `Yahoo returned ${resp.status}`, ticker }, resp.status, origin);
    html = await resp.text();
  } catch (e) {
    return json({ error: 'Failed to fetch Yahoo: ' + e.message, ticker }, 502, origin);
  }
  const finMap = {};
  const fins = [...html.matchAll(/<fin-streamer[^>]*data-field="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi)];
  for (const m of fins) { const key = m[1], raw = m[2]; const num = parseFloat(raw); finMap[key] = isNaN(num) ? raw : num; }
  const kvPairs = extractKeyValuePairs(html);
  const financial = {};
  const pn = s => { if (s == null) return null; const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const findKV = (keys) => { for (const k of keys) { const found = kvPairs.find(([label]) => label.toLowerCase().includes(k.toLowerCase())); if (found && found[1]) return found[1]; } return null; };
  financial.currentPrice = finMap.regularMarketPrice ?? null;
  financial.marketCap = finMap.marketCap ?? null;
  if (typeof financial.marketCap === 'string') financial.marketCap = parseMarketCap(financial.marketCap);
  financial.trailingPE = finMap.trailingPE ?? pn(findKV(['PE Ratio', 'Trailing P/E', 'PER']));
  financial.forwardPE = finMap.forwardPE ?? pn(findKV(['Forward P/E']));
  financial.trailingEps = finMap.epsTrailingTwelveMonths ?? pn(findKV(['EPS (TTM)', 'Trailing EPS', 'EPS']));
  financial.forwardEps = finMap.epsForward ?? pn(findKV(['Forward EPS']));
  financial.priceToBook = finMap.priceToBook ?? pn(findKV(['Price/Book', 'PBR', 'Price to Book']));
  financial.beta = pn(findKV(['Beta']));
  financial.targetMeanPrice = pn(findKV(['1y Target Est', 'Target Est']));
  financial.profitMargins = pn(findKV(['Profit Margin', '순이익률']));
  financial.returnOnEquity = pn(findKV(['Return on Equity', 'ROE']));
  financial.debtToEquity = pn(findKV(['Debt/Equity', 'Debt to Equity', 'D/E']));
  financial.revenueGrowth = pn(findKV(['Revenue Growth', '매출 성장']));
  financial.earningsGrowth = pn(findKV(['Earnings Growth', '이익 성장']));
  financial.sector = findKV(['Sector', '섹터']);
  financial.industry = findKV(['Industry', '산업']);
  financial.exDividendDate = findKV(['Ex-Dividend Date', '배당락일']);
  financial.previousClose = pn(findKV(['Previous Close']));
  financial.fiftyTwoWeekRange = findKV(['52 Week Range', '52주 범위']);
  const divRaw = findKV(['Forward Dividend & Yield', 'Dividend']);
  if (divRaw) { const dm = divRaw.match(/([\d.]+)\s*\(([\d.]+)%\)/); if (dm) { financial.dividendRate = parseFloat(dm[1]); financial.dividendYield = parseFloat(dm[2]); } else { const ym = divRaw.match(/([\d.]+)%/); if (ym) financial.dividendYield = parseFloat(ym[1]); } }
  const currMatch = html.match(/Currency\s+in\s+([A-Z]{3})/i);
  if (currMatch) financial.currency = currMatch[1];
  try { const ldm = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i); if (ldm) { const ld = JSON.parse(ldm[1]); if (ld.name) financial.longName = ld.name; } } catch (_) {}
  const valuation = {};
  const price = financial.currentPrice;
  const eps = financial.trailingEps;
  const pbr = financial.priceToBook;
  if (eps != null && eps > 0 && pbr != null && pbr > 0 && price) { const bv = price / pbr; valuation.bookValue = +bv.toFixed(2); valuation.grahamNumber = +Math.sqrt(22.5 * eps * bv).toFixed(2); valuation.grahamMargin = +((valuation.grahamNumber / price - 1) * 100).toFixed(1); }
  if (eps != null && price) valuation.earningsYield = +((eps / price) * 100).toFixed(2);
  if (financial.trailingPE != null) { const pe = financial.trailingPE; valuation.perBand = pe < 10 ? '저평가 구간' : pe < 15 ? '적정 하단' : pe < 20 ? '적정' : pe < 30 ? '적정 상단' : '고평가 구간'; }
  if (financial.trailingPE != null && financial.earningsGrowth != null && financial.earningsGrowth > 0) { valuation.pegRatio = +(financial.trailingPE / financial.earningsGrowth).toFixed(2); }
  const data = { financial, valuation, income: [], incomeQuarterly: [], balance: [], cashflow: [], epsTrend: [] };
  return new Response(JSON.stringify({ ticker, data, source: 'yahoo_html_deep', ts: Date.now() }), { status: 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

async function handleFundamental(request, url, origin) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return json({ error: 'Missing ticker param' }, 400, origin);
  const debug = url.searchParams.get('debug') === '1';
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`;
  let html;
  try {
    const resp = await fetch(yahooUrl, { headers: YF_HEADERS, redirect: 'follow' });
    if (!resp.ok) return json({ error: `Yahoo returned ${resp.status}`, ticker }, resp.status, origin);
    html = await resp.text();
  } catch (e) {
    return json({ error: 'Failed to fetch Yahoo: ' + e.message, ticker }, 502, origin);
  }
  if (debug) {
    const snippets = [];
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) snippets.push({ source: 'json-ld', content: jsonLdMatch[1].substring(0, 2000) });
    const tableMatches = [...html.matchAll(/<td[^>]*data-test="[^"]*"[^>]*>[\s\S]*?<\/td>/gi)];
    if (tableMatches.length) snippets.push({ source: 'data-test-td', count: tableMatches.length, samples: tableMatches.slice(0, 30).map(m => m[0]) });
    const finMatches = [...html.matchAll(/<fin-streamer[^>]*>[\s\S]*?<\/fin-streamer>/gi)];
    if (finMatches.length) snippets.push({ source: 'fin-streamer', count: finMatches.length, samples: finMatches.slice(0, 40).map(m => m[0]) });
    const appMainMatch = html.match(/root\.App\.main\s*=\s*(\{[\s\S]*?\});\s*\n/);
    if (appMainMatch) snippets.push({ source: 'App.main', content: appMainMatch[1].substring(0, 3000) });
    const preloadMatch = html.match(/"QuoteSummaryStore":\s*(\{[\s\S]*?\})\s*,\s*"/);
    if (preloadMatch) snippets.push({ source: 'QuoteSummaryStore', content: preloadMatch[1].substring(0, 3000) });
    const liMatches = [...html.matchAll(/<li[^>]*class="[^"]*yf-[^"]*"[^>]*>[\s\S]*?<\/li>/gi)];
    if (liMatches.length) snippets.push({ source: 'li-items', count: liMatches.length, samples: liMatches.slice(0, 30).map(m => m[0].substring(0, 300)) });
    return new Response(JSON.stringify({ ticker, debug: true, htmlLength: html.length, snippets }, null, 2), { status: 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
  }
  const data = {};
  try { const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i); if (jsonLdMatch) { const ld = JSON.parse(jsonLdMatch[1]); if (ld.name) data.longName = ld.name; if (ld.tickerSymbol) data.symbol = ld.tickerSymbol; if (ld.exchange) data.exchange = ld.exchange; } } catch (_) {}
  const finStreamers = [...html.matchAll(/<fin-streamer[^>]*data-field="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi)];
  const finData = {};
  for (const m of finStreamers) { finData[m[1]] = m[2]; }
  if (finData.regularMarketPrice) data.regularMarketPrice = finData.regularMarketPrice;
  if (finData.regularMarketChange) data.regularMarketChange = finData.regularMarketChange;
  if (finData.regularMarketChangePercent) data.regularMarketChangePercent = finData.regularMarketChangePercent;
  if (finData.regularMarketVolume) data.volume = finData.regularMarketVolume;
  if (finData.marketCap) data.marketCap = finData.marketCap;
  if (finData.regularMarketDayHigh) data.dayHigh = finData.regularMarketDayHigh;
  if (finData.regularMarketDayLow) data.dayLow = finData.regularMarketDayLow;
  const kvPairs = extractKeyValuePairs(html);
  const mapField = (keys, target) => { for (const k of keys) { const found = kvPairs.find(([label]) => label.toLowerCase().includes(k.toLowerCase())); if (found && found[1] && !data[target]) { data[target] = found[1]; break; } } };
  mapField(['Previous Close', '전일 종가'], 'previousClose');
  mapField(['Open', '시가'], 'open');
  mapField(['Bid', '매수호가'], 'bid');
  mapField(['Ask', '매도호가'], 'ask');
  mapField(["Day's Range", "일중 범위", 'Day Range'], 'dayRange');
  mapField(['52 Week Range', '52주 범위', '52 Wk Range'], 'fiftyTwoWeekRange');
  mapField(['Volume', '거래량'], 'volume');
  mapField(['Avg. Volume', 'Avg Volume', '평균 거래량'], 'avgVolume');
  mapField(['Market Cap', '시가총액'], 'marketCap');
  mapField(['Beta'], 'beta');
  mapField(['PE Ratio', 'P/E Ratio', 'PER', 'Trailing P/E'], 'trailingPE');
  mapField(['Forward P/E', 'Forward PE'], 'forwardPE');
  mapField(['EPS', 'EPS (TTM)', 'Trailing EPS'], 'trailingEps');
  mapField(['Forward EPS'], 'forwardEps');
  mapField(['Earnings Date', '실적 발표일'], 'earningsDate');
  mapField(['Dividend', 'Forward Dividend & Yield', 'Dividend Rate'], 'dividendRaw');
  mapField(['Ex-Dividend Date', '배당락일'], 'exDividendDate');
  mapField(['1y Target Est', '1y Target', 'Target Est'], 'targetMeanPrice');
  mapField(['Price/Book', 'P/B', 'PBR', 'Price to Book'], 'priceToBook');
  mapField(['Profit Margin', '순이익률'], 'profitMargins');
  mapField(['Return on Equity', 'ROE'], 'returnOnEquity');
  mapField(['Revenue Growth', '매출 성장'], 'revenueGrowth');
  mapField(['Earnings Growth', '이익 성장'], 'earningsGrowth');
  mapField(['Debt/Equity', 'Debt to Equity', 'D/E'], 'debtToEquity');
  mapField(['Sector', '섹터'], 'sector');
  mapField(['Industry', '산업'], 'industry');
  if (data.dividendRaw) { const divMatch = data.dividendRaw.match(/([\d.]+)\s*\(([\d.]+)%\)/); if (divMatch) { data.dividendRate = divMatch[1]; data.dividendYield = divMatch[2]; } else { const yieldOnly = data.dividendRaw.match(/([\d.]+)%/); if (yieldOnly) data.dividendYield = yieldOnly[1]; } delete data.dividendRaw; }
  const currMatch = html.match(/Currency\s+in\s+([A-Z]{3})/i);
  if (currMatch) data.currency = currMatch[1];
  if (typeof data.marketCap === 'string') { data.marketCap = parseMarketCap(data.marketCap); }
  return new Response(JSON.stringify({ ticker, data, source: 'yahoo_html_parse', ts: Date.now() }), { status: 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

function extractKeyValuePairs(html) {
  const pairs = [];
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liPattern.exec(html)) !== null) {
    const inner = liMatch[1];
    const spans = [...inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim());
    if (spans.length >= 2) { const label = spans[0]; const value = spans[spans.length - 1]; if (label && value && label !== value && label.length < 50 && value.length < 100) pairs.push([label, value]); }
  }
  const tdPattern = /<td[^>]*data-test="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
  let tdMatch;
  while ((tdMatch = tdPattern.exec(html)) !== null) { const label = tdMatch[1].replace(/_/g, ' ').replace(/-/g, ' '); const value = tdMatch[2].replace(/<[^>]*>/g, '').trim(); if (label && value) pairs.push([label, value]); }
  const trPattern = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let trMatch;
  while ((trMatch = trPattern.exec(html)) !== null) { const label = trMatch[1].replace(/<[^>]*>/g, '').trim(); const value = trMatch[2].replace(/<[^>]*>/g, '').trim(); if (label && value && label.length < 50 && value.length < 100) pairs.push([label, value]); }
  return pairs;
}

function parseMarketCap(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  str = String(str).trim().replace(/,/g, '');
  const match = str.match(/([\d.]+)\s*([TBMK])?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'T') num *= 1e12;
  else if (suffix === 'B') num *= 1e9;
  else if (suffix === 'M') num *= 1e6;
  else if (suffix === 'K') num *= 1e3;
  return num;
}

async function handleGenericProxy(request, url, origin) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return json({ error: 'Missing url param' }, 400);
  const allowed = ['query1.finance.yahoo.com','query2.finance.yahoo.com','finance.yahoo.com','api.upbit.com'];
  let targetHost;
  try { targetHost = new URL(targetUrl).hostname; } catch (_) { return json({ error: 'Invalid url' }, 400); }
  if (!allowed.some(d => targetHost === d || targetHost.endsWith('.' + d))) return json({ error: 'Domain not allowed: ' + targetHost }, 403);
  const resp = await fetch(targetUrl, { method: request.method, headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  const body = await resp.text();
  return new Response(body, { status: resp.status, headers: { ...corsHeaders(origin), 'Content-Type': resp.headers.get('Content-Type') || 'application/json' } });
}

async function handleKisProxy(request, url, origin) {
  const kisPath = url.pathname.replace(/^\/kis/, '');
  const qs = url.search;
  const isMock = request.headers.get('x-kis-mock') === '1';
  const base = isMock ? 'https://openapivts.koreainvestment.com:29443' : 'https://openapi.koreainvestment.com:9443';
  const targetUrl = base + kisPath + qs;
  const fwdHeaders = new Headers();
  for (const key of ['authorization','appkey','appsecret','tr_id','content-type','custtype','hashkey']) { const val = request.headers.get(key); if (val) fwdHeaders.set(key, val); }
  if (!fwdHeaders.has('content-type')) fwdHeaders.set('Content-Type', 'application/json; charset=utf-8');
  const init = { method: request.method, headers: fwdHeaders, redirect: 'follow' };
  if (request.method === 'POST') init.body = await request.text();
  const resp = await fetch(targetUrl, init);
  const body = await resp.text();
  return new Response(body, { status: resp.status, headers: { ...corsHeaders(origin), 'Content-Type': resp.headers.get('Content-Type') || 'application/json' } });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,appkey,appsecret,tr_id,content-type,custtype,hashkey,x-kis-mock',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin) {
  const h = origin ? { ...corsHeaders(origin), 'Content-Type': 'application/json' } : { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  return new Response(JSON.stringify(data), { status, headers: h });
}
