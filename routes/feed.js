// routes/feed.js — 积分动态分享页（/f/:id）：单条动态独立链接 + 可保存分享海报
// 背景：微信不读 OG 标签，无认证服务号无法用 JS-SDK 做卡片（2026-11-22 调研结论）
//       → 提供「独立网页链接（含标题/meta，微信降级卡片可读）+ 一键生成海报图片」
// 隐私：姓名脱敏（保留姓 + *）；仅展示 approved + 未撤回 + show_in_feed 的记录
const router = require('express').Router();
const db = require('../config/db');

function maskName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 1);
}

function fmtDate(d) {
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 图片路径安全编码：文件名可能含中文（如 v705_参加环境清扫_xxx.jpg），未编码会 404
function encPath(p) {
  return String(p || '').split('/').map(function (seg) { return encodeURIComponent(seg); }).join('/');
}

async function loadRecord(id) {
  const [rows] = await db.execute(
    'SELECT sr.id, v.name AS villager_name, v.group_no, sr.event_name, sr.points, sr.description, sr.image_urls, sr.created_at ' +
    'FROM score_records sr JOIN villagers v ON v.id = sr.villager_id ' +
    "WHERE sr.id=? AND sr.status='approved' AND sr.is_revoked=0 AND sr.show_in_feed=1 LIMIT 1",
    [parseInt(id, 10) || 0]
  );
  if (!rows.length) return null;
  const r = rows[0];
  let imgs = [];
  try { imgs = typeof r.image_urls === 'string' ? JSON.parse(r.image_urls || '[]') : (r.image_urls || []); } catch (e) { imgs = []; }
  if (!Array.isArray(imgs)) imgs = [];
  r.image_urls = imgs.slice(0, 3);
  return r;
}

// GET /f/:id —— 单条动态网页（服务端渲染标题/meta，微信分享降级也能显示动态标题）
router.get('/f/:id', async function (req, res) {
  let r = null;
  try { r = await loadRecord(req.params.id); } catch (e) { console.error('[FEED]', e.message); }
  if (!r) return res.status(404).send('<meta charset="utf-8"><div style="padding:40px;text-align:center;font-family:sans-serif;">该动态不存在或已撤回</div>');

  const add = Number(r.points) > 0;
  const pts = (add ? '+' : '') + Number(r.points);
  // 2026-11-23 用户要求：分享页显示完整姓名（与公开「积分动态」列表口径一致）
  const name = String(r.villager_name || '');
  const date = fmtDate(r.created_at);
  const title = name + ' ' + r.event_name + '（' + pts + '分）· 罗峪村积分动态';
  const url = 'https://luoyu.goodsport.fun/f/' + r.id;
  const desc = [r.event_name, date, r.group_no ? String(r.group_no).replace('罗峪村', '') : ''].filter(Boolean).join(' ｜ ');
  const img = r.image_urls[0] ? 'https://luoyu.goodsport.fun' + encPath(r.image_urls[0]) : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${img ? '<meta property="og:image" content="' + esc(img) + '">' : ''}
<style>
  :root{--green:#3B6D11;--green-dark:#27500A;--green-bg:#EAF3DE;--red:#B3261E;--red-bg:#FDECEC;--text:#1a1a1a;--text2:#666;--text3:#9A9186;--border:#E4E0D8;--card:#fff;--bg:#F7F5F0;}
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  body{background:var(--bg);font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);min-height:100vh;padding-bottom:32px;}
  .hero{background:var(--green);color:#fff;padding:22px 20px 26px;border-radius:0 0 22px 22px;}
  .hero .v{font-size:13px;opacity:.85;letter-spacing:.1em;}
  .hero .t{font-size:19px;font-weight:700;margin-top:6px;}
  .card{background:var(--card);margin:16px 16px 0;border-radius:16px;padding:22px 20px;border:1px solid var(--border);}
  .pts{font-size:52px;font-weight:800;letter-spacing:-1px;line-height:1.1;}
  .pts.add{color:var(--green);} .pts.sub{color:var(--red);}
  .evt{font-size:21px;font-weight:700;margin-top:8px;line-height:1.45;}
  .who{font-size:15px;color:var(--text2);margin-top:10px;}
  .meta{font-size:14px;color:var(--text3);margin-top:6px;}
  .desc{font-size:16px;line-height:1.85;color:var(--text);margin-top:16px;padding-top:16px;border-top:1px dashed var(--border);white-space:pre-wrap;}
  .imgs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:14px;}
  .imgs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;}
  .ops{margin:20px 16px 0;display:flex;flex-direction:column;gap:12px;}
  .btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border-radius:14px;border:none;font-size:17px;font-weight:600;cursor:pointer;transition:transform .1s,box-shadow .1s;}
  .btn:active{transform:translateY(3px);}
  .btn.primary{background:linear-gradient(180deg,#5a9a26,var(--green));color:#fff;box-shadow:0 4px 0 var(--green-dark),0 6px 14px rgba(0,0,0,.18),inset 0 2px 0 rgba(255,255,255,.3);}
  .btn.primary:active{box-shadow:0 1px 0 var(--green-dark),0 2px 6px rgba(0,0,0,.15);}
  .btn.plain{background:var(--card);color:var(--text2);border:1.5px solid var(--border);box-shadow:0 3px 0 #ddd;}
  .btn.plain:active{box-shadow:0 1px 0 #ddd;}
  .foot{text-align:center;font-size:12px;color:var(--text3);margin-top:22px;line-height:1.8;}
  #posterBox{display:none;text-align:center;margin-top:16px;}
  #posterBox img{max-width:100%;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.15);}
  .tip{font-size:12.5px;color:var(--text3);text-align:center;margin-top:8px;}
</style>
</head>
<body>
<div class="hero">
  <div class="v">罗峪村 · 积分动态</div>
  <div class="t">${esc(name)} ${esc(r.event_name)}</div>
</div>

<div class="card">
  <div class="pts ${add ? 'add' : 'sub'}">${pts}<span style="font-size:20px;font-weight:600;"> 分</span></div>
  <div class="evt">${esc(r.event_name)}</div>
  <div class="who">👤 ${esc(name)}${r.group_no ? ' · ' + esc(String(r.group_no).replace('罗峪村', '')) : ''}</div>
  <div class="meta">📅 ${esc(date)}</div>
  ${r.description ? '<div class="desc">' + esc(r.description) + '</div>' : ''}
  ${r.image_urls.length ? '<div class="imgs">' + r.image_urls.map(function (u) { return '<img src="' + esc(encPath(u)) + '" alt="">'; }).join('') + '</div>' : ''}
</div>

<div class="ops">
  <button class="btn primary" onclick="makePoster()">🖼 生成分享海报</button>
  <button class="btn plain" onclick="copyLink()">🔗 复制本页链接</button>
</div>
<div id="posterBox"><img id="posterImg" alt="分享海报"><div class="tip">长按图片可保存到相册，再发微信群或朋友圈</div></div>

<div class="foot">罗峪村村民积分系统<br>积分共建 · 美丽乡村</div>

<canvas id="cv" width="750" height="1000" style="display:none;"></canvas>
<script src="/vendor/qrcode.min.js"></script>
<script>
var DATA = ${JSON.stringify({ id: r.id, name: name, event: r.event_name, points: Number(r.points), desc: r.description || '', date: date, group: r.group_no ? String(r.group_no).replace('罗峪村', '') : '', url: url, imgs: r.image_urls.map(encPath) })};

function copyLink() {
  var t = DATA.url;
  function ok() { alert('链接已复制，可粘贴到微信发送'); }
  function fb() {
    var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { prompt('请长按复制链接：', t); }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fb); else fb();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  var line = '', lines = [];
  for (var i = 0; i < text.length; i++) {
    var test = line + text[i];
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; }
    else line = test;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineH); });
  return lines.length;
}

// 载入图片（同源 /uploads，不会被 canvas 污染）；失败返回 null
function loadImg(src) {
  return new Promise(function (resolve) {
    if (!src) return resolve(null);
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function () { resolve(null); };
    im.src = src;
  });
}
// cover 裁切绘制
function drawCover(ctx, img, x, y, w, h) {
  var ir = img.width / img.height, tr = w / h, sw, sh, sx, sy;
  if (ir > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / tr; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function makePoster() {
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  var btn = document.querySelector('.ops .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = '正在生成…'; }

  // 先尝试载入记录照片（最多 1 张主图）
  var photo = null;
  if (DATA.imgs && DATA.imgs.length) photo = await loadImg(DATA.imgs[0]);

  var W = 750;
  var H = photo ? 1400 : 1000;
  cv.width = W; cv.height = H;   // 画布尺寸随是否带图变化
  // 底
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#F7F5F0'); g.addColorStop(1, '#EFEBE2');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 顶部绿带
  var g2 = ctx.createLinearGradient(0, 0, W, 0);
  g2.addColorStop(0, '#3B6D11'); g2.addColorStop(1, '#5a9a26');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = '#fff';
  ctx.font = '600 30px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('罗峪村 · 积分动态', 60, 68);
  ctx.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.globalAlpha = .85; ctx.fillText(DATA.date + (DATA.group ? ' ｜ ' + DATA.group : ''), 60, 108);
  ctx.globalAlpha = 1;

  // 主卡片
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.10)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
  roundRect(ctx, 50, 190, 650, 470, 24); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // 分数
  var add = DATA.points > 0;
  ctx.fillStyle = add ? '#3B6D11' : '#B3261E';
  ctx.font = '800 110px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText((add ? '+' : '') + DATA.points, 96, 330);
  var pw = ctx.measureText((add ? '+' : '') + DATA.points).width;
  ctx.font = '600 32px "PingFang SC",sans-serif';
  ctx.fillText('分', 96 + pw + 12, 330);

  // 事件名（最多 2 行）
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif';
  wrapText(ctx, DATA.event, 96, 400, 560, 56, 2);

  // 姓名
  ctx.fillStyle = '#666';
  ctx.font = '400 28px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('👤 ' + DATA.name, 96, 512);

  // 描述（最多 3 行）
  if (DATA.desc) {
    ctx.fillStyle = '#444';
    ctx.font = '400 26px "PingFang SC","Microsoft YaHei",sans-serif';
    wrapText(ctx, DATA.desc, 96, 566, 560, 40, 3);
  }

  // 现场照片卡片（有图时才画，宽度撑满卡片、4:3 裁切）
  var qrTop = 700;
  if (photo) {
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.10)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
    roundRect(ctx, 50, 690, 650, 380, 24); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.save();
    roundRect(ctx, 70, 710, 610, 340, 16); ctx.clip();
    drawCover(ctx, photo, 70, 710, 610, 340);
    ctx.restore();
    qrTop = 1100;
  }

  // 二维码卡片
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.10)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
  roundRect(ctx, 50, qrTop, 650, 200, 24); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  var qrHost = document.createElement('div');
  new QRCode(qrHost, { text: DATA.url, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
  var qrCanvas = qrHost.querySelector('canvas') || qrHost.querySelector('img');
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '600 30px "PingFang SC",sans-serif';
  ctx.fillText('扫码查看这条积分动态', 240, qrTop + 70);
  ctx.fillStyle = '#9A9186';
  ctx.font = '400 22px "PingFang SC",sans-serif';
  ctx.fillText('罗峪村村民积分系统', 240, qrTop + 112);
  ctx.fillText('积分共建 · 美丽乡村', 240, qrTop + 148);
  if (qrCanvas) {
    try { ctx.drawImage(qrCanvas, 80, qrTop + 25, 130, 130); } catch (e) {}
  }

  // 底部
  ctx.fillStyle = '#9A9186';
  ctx.font = '400 22px "PingFang SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('数据来自罗峪村积分系统 ｜ ' + DATA.date, W / 2, qrTop + 250);
  ctx.textAlign = 'left';

  var img = document.getElementById('posterImg');
  img.src = cv.toDataURL('image/png');
  document.getElementById('posterBox').style.display = 'block';
  img.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (btn) { btn.disabled = false; btn.textContent = '🖼 生成分享海报'; }
}
</script>
</body>
</html>`);
});

module.exports = router;
