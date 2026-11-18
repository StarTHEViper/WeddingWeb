#!/usr/bin/env node
/**
 * 婚礼请帖 · 回执后台（零依赖，Node 18+，不需要 npm install）
 * ---------------------------------------------------------------
 * 启动：  node server.js
 * 打开：  http://localhost:8080/            → 请帖（index.html 版本选择页）
 *        http://localhost:8080/classic.html
 *        http://localhost:8080/stardew.html
 *        http://localhost:8080/admin?token=口令   → 回执统计后台
 *
 * 环境变量（都可不填）：
 *   PORT=8080                    端口，云平台通常会自动注入
 *   ADMIN_TOKEN=mysecret         后台口令。不填则每次启动随机生成并打印在控制台
 *   DATA_DIR=./data              数据目录（默认同目录 data/）
 *   WEBHOOK_URL=...              每次回执推送到群机器人（钉钉/飞书/企业微信）
 *   WEBHOOK_TYPE=dingtalk|feishu|wecom
 *   WX_APPID / WX_SECRET         已认证公众号的 AppID/AppSecret，填了才有 /api/wx-signature（自定义微信分享卡片用）
 *
 * 数据文件：
 *   data/rsvp.json   全部回执（数组，可用记事本打开备份）
 *   data/rsvp.csv    Excel 可直接打开的表格
 * ---------------------------------------------------------------
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const JSON_FILE = path.join(DATA_DIR, 'rsvp.json');
const CSV_FILE = path.join(DATA_DIR, 'rsvp.csv');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(6).toString('hex');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_TYPE = (process.env.WEBHOOK_TYPE || 'dingtalk').toLowerCase();
const WX_APPID = process.env.WX_APPID || '';
const WX_SECRET = process.env.WX_SECRET || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

/* ============ 数据 ============ */
let records = [];

function loadData() {
  try {
    const raw = fs.readFileSync(JSON_FILE, 'utf8');
    const arr = JSON.parse(raw);
    records = Array.isArray(arr) ? arr : [];
  } catch (e) {
    records = [];
  }
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** ISO 时间 → 北京时间字符串 */
function fmtTime(iso) {
  if (!iso) return '';
  const t = new Date(Date.parse(iso));
  if (isNaN(t.getTime())) return String(iso);
  const b = new Date(t.getTime() + 8 * 3600 * 1000);
  return b.getUTCFullYear() + '-' + pad2(b.getUTCMonth() + 1) + '-' + pad2(b.getUTCDate()) +
         ' ' + pad2(b.getUTCHours()) + ':' + pad2(b.getUTCMinutes());
}

function csvCell(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv() {
  const head = ['提交时间', '姓名', '出席情况', '同行人数', '联系电话/微信', '留言/忌口', '来源'];
  const lines = [head.map(csvCell).join(',')];
  records.forEach(function (r) {
    lines.push([
      fmtTime(r.createdAt), r.name, r.attend,
      r.guests === 4 ? '4 位及以上' : r.guests + ' 位',
      r.contact, r.note, r.source
    ].map(csvCell).join(','));
  });
  fs.writeFileSync(CSV_FILE, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}

function saveData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = JSON_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmp, JSON_FILE);
  try { writeCsv(); } catch (e) { console.error('[warn] 写 CSV 失败:', e.message); }
}

function guestNum(g) {
  const n = parseInt(String(g).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

function stats() {
  const go = records.filter(function (r) { return r.attend === '出席'; });
  return {
    total: records.length,
    goingHouseholds: go.length,
    goingPeople: go.reduce(function (s, r) { return s + guestNum(r.guests); }, 0),
    absent: records.filter(function (r) { return r.attend === '缺席'; }).length
  };
}

/* ============ HTTP 小工具 ============ */
function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendJson(res, code, obj) {
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function readBody(req, limit) {
  limit = limit || 64 * 1024;
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
function clientIp(req) {
  const h = req.headers['x-forwarded-for'];
  if (h) return String(h).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* 简易频率限制：同一 IP 每分钟最多 20 次回执 */
const hits = new Map();
function tooFast(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(function (t) { return now - t < 60000; });
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 20;
}

/* ============ 群机器人推送（可选） ============ */
async function notify(r, updated) {
  if (!WEBHOOK_URL || typeof fetch !== 'function') return;
  const label = r.attend === '出席'
    ? '出席 ' + (r.guests === 4 ? '4 位及以上' : guestNum(r.guests) + ' 位')
    : '遗憾缺席';
  const text = (updated ? '【回执更新】' : '【收到新回执】') + r.name + ' · ' + label +
    (r.contact ? '\n联系：' + r.contact : '') +
    (r.note ? '\n留言：' + r.note : '');
  let payload;
  if (WEBHOOK_TYPE === 'feishu' || WEBHOOK_TYPE === 'lark') {
    payload = { msg_type: 'text', content: { text: text } };
  } else {
    payload = { msgtype: 'text', text: { content: text } };
  }
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('[warn] 推送群机器人失败:', e.message);
  }
}

/* ============ 回执接口 ============ */
async function handleRsvp(req, res) {
  const ip = clientIp(req);
  if (tooFast(ip)) return sendJson(res, 429, { ok: false, error: '提交太频繁，请稍后再试' });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: '数据格式不对' });
  }
  if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: '数据格式不对' });

  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return sendJson(res, 400, { ok: false, error: '请填写姓名' });

  const attendRaw = String(body.attend || '');
  const attend = attendRaw.indexOf('缺席') >= 0 ? '缺席' : '出席';
  let guests = parseInt(body.guests, 10);
  if (isNaN(guests) || guests < 1) guests = 1;
  if (guests > 30) guests = 30;

  const contact = String(body.contact || '').trim().slice(0, 60);
  const note = String(body.note || '').trim().slice(0, 300);
  const source = String(body.source || '').trim().slice(0, 30);
  const now = new Date().toISOString();

  let rec = records.find(function (r) { return r.name === name; });
  const updated = !!rec;
  if (rec) {
    rec.attend = attend;
    rec.guests = guests;
    rec.contact = contact;
    rec.note = note;
    rec.updatedAt = now;
    rec.source = source || rec.source;
  } else {
    rec = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      name: name, attend: attend, guests: guests,
      contact: contact, note: note, source: source,
      createdAt: now, updatedAt: now
    };
    records.push(rec);
  }
  saveData();
  notify(rec, updated);

  console.log('[' + fmtTime(now) + '] ' + (updated ? '更新' : '新回执') + ' ' + name +
              ' · ' + attend + (attend === '出席' ? ' ' + guests + ' 人' : ''));

  sendJson(res, 200, { ok: true, updated: updated, stats: stats() });
}

/* ============ 删除一条 ============ */
async function handleDelete(req, res, url) {
  if (url.searchParams.get('token') !== ADMIN_TOKEN) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  let name = '';
  try {
    const raw = await readBody(req, 8192);
    const params = new URLSearchParams(raw);
    name = String(params.get('name') || '').trim();
    if (!name) {
      try { name = String(JSON.parse(raw).name || '').trim(); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  if (name) {
    const before = records.length;
    records = records.filter(function (r) { return r.name !== name; });
    if (records.length !== before) { saveData(); console.log('[删除] ' + name); }
  }
  res.writeHead(303, { Location: '/admin?token=' + encodeURIComponent(ADMIN_TOKEN) });
  res.end();
}

/* ============ 导出 CSV ============ */
function exportCsv(res, url) {
  if (url.searchParams.get('token') !== ADMIN_TOKEN) return send(res, 401, 'text/plain; charset=utf-8', 'unauthorized');
  try { writeCsv(); } catch (e) { /* ignore */ }
  let content = '';
  try { content = fs.readFileSync(CSV_FILE, 'utf8'); } catch (e) { content = ''; }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="wedding-rsvp.csv"',
    'Cache-Control': 'no-store'
  });
  res.end(content);
}

/* ============ 统计后台页面 ============ */
function adminPage(req, res, url) {
  if (url.searchParams.get('token') !== ADMIN_TOKEN) {
    return send(res, 401, 'text/html; charset=utf-8',
      '<!DOCTYPE html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">' +
      '<h2>401 · 口令不对</h2><p>请在链接后面加上 <code>?token=你的口令</code>。</p></body>');
  }
  const s = stats();
  const go = records.filter(function (r) { return r.attend === '出席'; })
    .slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
  const no = records.filter(function (r) { return r.attend === '缺席'; });

  const rows = records.slice().sort(function (a, b) {
    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  }).map(function (r) {
    const safeName = String(r.name).replace(/['"<>&\\]/g, '');
    return '<tr class="' + (r.attend === '缺席' ? 'no' : '') + '">' +
      '<td class="t">' + esc(fmtTime(r.createdAt)) + '</td>' +
      '<td class="n">' + esc(r.name) + '</td>' +
      '<td>' + (r.attend === '出席' ? '出席' : '缺席') + '</td>' +
      '<td>' + (r.attend === '出席' ? (r.guests === 4 ? '4+' : r.guests) : '—') + '</td>' +
      '<td class="t">' + esc(r.contact) + '</td>' +
      '<td class="note">' + esc(r.note) + '</td>' +
      '<td><form method="post" action="/admin/delete?token=' + encodeURIComponent(ADMIN_TOKEN) + '" ' +
      'onsubmit="return confirm(\'删除 ' + safeName + ' 的回执？\')">' +
      '<input type="hidden" name="name" value="' + esc(r.name) + '">' +
      '<button class="del">删除</button></form></td></tr>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>回执统计 · 婚礼</title><style>' +
    '*{box-sizing:border-box}body{margin:0;padding:24px 16px 60px;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;' +
    'background:#FBF7F1;color:#26221D;line-height:1.7}' +
    '.wrap{max-width:960px;margin:0 auto}' +
    'h1{font-size:19px;font-weight:600;margin:0 0 4px;letter-spacing:.06em}' +
    '.sub{font-size:12px;color:#8b8175;margin:0 0 22px}' +
    '.cards{display:grid;gap:10px;grid-template-columns:repeat(2,1fr);margin-bottom:22px}' +
    '@media(min-width:640px){.cards{grid-template-columns:repeat(4,1fr)}}' +
    '.card{background:#fff;border:1px solid rgba(60,75,65,.14);padding:14px 16px}' +
    '.card b{display:block;font-size:26px;line-height:1.2;color:#3C4B41;font-variant-numeric:tabular-nums}' +
    '.card span{font-size:11.5px;color:#8b8175;letter-spacing:.08em}' +
    '.card.hi b{color:#B4936A}' +
    '.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}' +
    '.btn{display:inline-block;text-decoration:none;font:inherit;font-size:12.5px;cursor:pointer;' +
    'padding:9px 16px;border:1px solid rgba(60,75,65,.3);background:#fff;color:#3C4B41}' +
    '.btn:hover{background:rgba(60,75,65,.06)}' +
    'table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(60,75,65,.14);font-size:13px}' +
    'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid rgba(60,75,65,.1);vertical-align:top}' +
    'th{font-size:11px;letter-spacing:.1em;color:#8b8175;font-weight:500;background:#FCFAF5;white-space:nowrap}' +
    'tr.no{color:#a09a90}td.t{white-space:nowrap;color:#8b8175;font-size:12px}' +
    'td.n{font-weight:600;white-space:nowrap}td.note{max-width:220px;color:#5c554b;font-size:12px}' +
    '.del{font:inherit;font-size:11px;color:#b04a3a;background:none;border:1px solid rgba(176,74,58,.35);' +
    'padding:3px 9px;cursor:pointer}' +
    '.del:hover{background:rgba(176,74,58,.08)}' +
    '.scroll{overflow-x:auto}' +
    '.tip{font-size:11.5px;color:#8b8175;margin:16px 0 0;line-height:1.9}' +
    'code{background:rgba(0,0,0,.05);padding:1px 5px;font-size:12px}' +
    '</style></head><body><div class="wrap">' +
    '<h1>回执统计</h1>' +
    '<p class="sub">2026.12.20 · 杭州嘉宝丽酒店　最后刷新：' + esc(fmtTime(new Date().toISOString())) + '</p>' +
    '<div class="cards">' +
    '<div class="card hi"><b>' + s.goingPeople + '</b><span>预计出席总人数</span></div>' +
    '<div class="card"><b>' + s.goingHouseholds + '</b><span>出席回执（份）</span></div>' +
    '<div class="card"><b>' + s.absent + '</b><span>遗憾缺席</span></div>' +
    '<div class="card"><b>' + s.total + '</b><span>回执总数</span></div>' +
    '</div>' +
    '<div class="bar">' +
    '<a class="btn" href="/admin/export.csv?token=' + encodeURIComponent(ADMIN_TOKEN) + '">⬇ 导出 Excel（CSV）</a>' +
    '<a class="btn" href="/admin?token=' + encodeURIComponent(ADMIN_TOKEN) + '">↻ 刷新</a>' +
    '<a class="btn" href="/" target="_blank">↗ 打开请帖</a>' +
    '</div>' +
    '<div class="scroll"><table><thead><tr>' +
    '<th>提交时间</th><th>姓名</th><th>出席</th><th>人数</th><th>联系</th><th>留言 / 忌口</th><th></th>' +
    '</tr></thead><tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#8b8175;padding:28px">还没有回执</td></tr>') +
    '</tbody></table></div>' +
    '<p class="tip">「4+」表示宾客填的是「4 位及以上」，人数统计里按 4 人计算，实际以你确认为准。<br>' +
    '同名回执会自动合并（以最后一次提交为准），所以宾客改主意重新填也不会重复计数。<br>' +
    '这个页面的链接请自己保存好，不要发到群里：<code>/admin?token=' + esc(ADMIN_TOKEN) + '</code></p>' +
    '</div></body></html>';

  send(res, 200, 'text/html; charset=utf-8', html);
}

/* ============ 微信 JS-SDK 签名（有公众号才用得上） ============ */
const wxCache = { token: '', tokenExp: 0, ticket: '', ticketExp: 0 };

async function wxSignature(req, res, url) {
  if (!WX_APPID || !WX_SECRET) {
    return sendJson(res, 501, { ok: false, error: '未配置 WX_APPID / WX_SECRET' });
  }
  const target = url.searchParams.get('url');
  if (!target) return sendJson(res, 400, { ok: false, error: '缺少 url 参数' });

  if (Date.now() > wxCache.tokenExp) {
    const r = await fetch('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
      encodeURIComponent(WX_APPID) + '&secret=' + encodeURIComponent(WX_SECRET)).then(function (x) { return x.json(); });
    if (!r.access_token) throw new Error('access_token 失败：' + JSON.stringify(r));
    wxCache.token = r.access_token;
    wxCache.tokenExp = Date.now() + (r.expires_in - 300) * 1000;
  }
  if (Date.now() > wxCache.ticketExp) {
    const r = await fetch('https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=' +
      encodeURIComponent(wxCache.token) + '&type=jsapi').then(function (x) { return x.json(); });
    if (!r.ticket) throw new Error('jsapi_ticket 失败：' + JSON.stringify(r));
    wxCache.ticket = r.ticket;
    wxCache.ticketExp = Date.now() + (r.expires_in - 300) * 1000;
  }
  const nonceStr = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const clean = String(target).split('#')[0];
  const raw = 'jsapi_ticket=' + wxCache.ticket + '&noncestr=' + nonceStr +
              '&timestamp=' + timestamp + '&url=' + clean;
  const signature = crypto.createHash('sha1').update(raw).digest('hex');
  sendJson(res, 200, { ok: true, appId: WX_APPID, timestamp: timestamp, nonceStr: nonceStr, signature: signature });
}

/* ============ 静态文件 ============ */
const DENY = ['/data', '/server.js', '/package.json', '/package-lock.json', '/node_modules'];

function notFound(res) {
  send(res, 404, 'text/html; charset=utf-8',
    '<!DOCTYPE html><meta charset="utf-8"><title>404</title>' +
    '<body style="font-family:system-ui;padding:44px;background:#FBF7F1;color:#26221D">' +
    '<h2>404 · 页面不存在</h2><p><a href="/">回到请帖首页</a></p></body>');
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request'); }
  if (rel === '/' || rel === '') rel = '/index.html';

  for (let i = 0; i < DENY.length; i++) {
    if (rel === DENY[i] || rel.indexOf(DENY[i] + '/') === 0) {
      return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    }
  }
  if (rel.indexOf('/.') === 0 || rel.indexOf('/.') > 0) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }

  const full = path.join(ROOT, rel);
  if (full !== ROOT && full.indexOf(ROOT + path.sep) !== 0) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }

  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

/* ============ 路由 ============ */
const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
  }
  const p = url.pathname;

  if (req.method === 'POST' && p === '/api/rsvp') {
    return handleRsvp(req, res).catch(function (e) {
      console.error('[error] /api/rsvp', e);
      sendJson(res, 500, { ok: false, error: '服务器开小差了' });
    });
  }
  if (req.method === 'POST' && p === '/admin/delete') {
    return handleDelete(req, res, url).catch(function (e) {
      console.error('[error] /admin/delete', e);
      sendJson(res, 500, { ok: false, error: '删除失败' });
    });
  }
  if (req.method === 'GET' && p === '/admin') return adminPage(req, res, url);
  if (req.method === 'GET' && p === '/admin/export.csv') return exportCsv(res, url);
  if (req.method === 'GET' && p === '/api/wx-signature') {
    return wxSignature(req, res, url).catch(function (e) {
      console.error('[error] /api/wx-signature', e);
      sendJson(res, 500, { ok: false, error: String(e.message || e) });
    });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);

  send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
});

loadData();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (records.length) { try { writeCsv(); } catch (e) { /* ignore */ } }

server.listen(PORT, function () {
  const line = '─'.repeat(58);
  console.log('');
  console.log(line);
  console.log('  婚礼请帖已启动');
  console.log(line);
  console.log('  请帖首页   http://localhost:' + PORT + '/');
  console.log('  优雅常规版 http://localhost:' + PORT + '/classic.html');
  console.log('  星露谷版   http://localhost:' + PORT + '/stardew.html');
  console.log('  回执后台   http://localhost:' + PORT + '/admin?token=' + ADMIN_TOKEN);
  console.log(line);
  console.log('  后台口令   ' + ADMIN_TOKEN);
  console.log('  数据目录   ' + DATA_DIR);
  console.log('  已有回执   ' + records.length + ' 份');
  console.log(line);
  console.log('  提示：把后台链接收藏好，别发到群里。');
  console.log('  想固定口令：启动前设置环境变量 ADMIN_TOKEN');
  console.log('');
});

process.on('uncaughtException', function (e) {
  console.error('[uncaught]', e && e.message);
});
