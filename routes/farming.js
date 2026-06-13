// routes/farming.js
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_TTL = 30 * 60 * 1000;

// 心知天气 HMAC-SHA1 签名
function seniverseSign(params, secret) {
  var keys = Object.keys(params).sort();
  var paramStr = keys.map(function(k) { return k + '=' + params[k]; }).join('&');
  return encodeURIComponent(crypto.createHmac('sha1', secret).update(paramStr).digest('base64'));
}

// GET /api/farming/weather — 心知天气
router.get('/weather', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var now = Date.now();
  if (weatherCache && (now - weatherCacheTime) < WEATHER_TTL) {
    return res.json({ code: 0, data: weatherCache, cached: true });
  }

  var pk = process.env.SENIVERSE_KEY || 'PxEaesvqbOgA_DGOZ';
  var sk = process.env.SENIVERSE_SECRET || 'SG0NKHj5PyD8pArP5';
  var loc = '29.50:109.90';
  var ts = Math.floor(Date.now() / 1000);

  try {
    var np = { public_key: pk, ts: ts, ttl: 300, location: loc, language: 'zh-Hans', unit: 'c' };
    var nUrl = 'https://api.seniverse.com/v3/weather/now.json?' +
      Object.keys(np).sort().map(function(k) { return k + '=' + np[k]; }).join('&') +
      '&sig=' + seniverseSign(np, sk);
    var nowRes = await fetch(nUrl).then(function(r) { return r.json(); });
    var nd = (nowRes.results && nowRes.results[0]) ? nowRes.results[0].now : null;

    var dp = { public_key: pk, ts: ts, ttl: 300, location: loc, language: 'zh-Hans', unit: 'c', days: 5 };
    var dUrl = 'https://api.seniverse.com/v3/weather/daily.json?' +
      Object.keys(dp).sort().map(function(k) { return k + '=' + dp[k]; }).join('&') +
      '&sig=' + seniverseSign(dp, sk);
    var dayRes = await fetch(dUrl).then(function(r) { return r.json(); });
    var daily = (dayRes.results && dayRes.results[0]) ? dayRes.results[0].daily : [];
    var today = daily[0] || {};

    if (!nd) throw new Error('实时天气无数据');

    var rain3 = false, rain5 = false;
    daily.slice(0, 3).forEach(function(d) {
      if ((d.text_day && d.text_day.indexOf('雨') >= 0) || (d.text_night && d.text_night.indexOf('雨') >= 0)) rain3 = true;
    });
    daily.slice(0, 5).forEach(function(d) {
      if ((d.text_day && d.text_day.indexOf('雨') >= 0) || (d.text_night && d.text_night.indexOf('雨') >= 0)) rain5 = true;
    });

    var w = {
      temp: parseFloat(nd.temperature) || 0,
      feels_like: parseFloat(nd.temperature) || 0,
      humidity: parseFloat(today.humidity) || 0,
      wind_speed: parseFloat(today.wind_speed) || 0,
      wind_scale: today.wind_scale || '',
      weather_type: nd.text || '',
      weather_text: nd.text || '',
      precip: parseFloat(today.rainfall) || 0,
      rain_3day: rain3,
      rain_5day: rain5,
      daily_max: parseFloat(today.high) || 0,
      daily_min: parseFloat(today.low) || 0,
      daily_text_day: today.text_day || '',
      daily_text_night: today.text_night || '',
      updated: new Date().toISOString()
    };

    weatherCache = w;
    weatherCacheTime = now;
    res.json({ code: 0, data: w });
  } catch (e) {
    if (weatherCache) return res.json({ code: 0, data: weatherCache, cached: true });
    res.status(500).json({ code: 500, message: '天气获取失败: ' + e.message });
  }
}));

// ── 规则 CRUD ──
router.get('/rules', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var [rows] = await db.execute('SELECT id,title,task_type,conditions,suggestion,priority,is_active FROM farming_rules ORDER BY priority DESC');
  rows.forEach(function(r) { try { r.conditions = JSON.parse(r.conditions); } catch(e) {} });
  res.json({ code: 0, data: rows });
}));

router.post('/rules', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { title, task_type, conditions, suggestion, priority } = req.body;
  if (!title || !conditions || !suggestion) return res.status(400).json({ code: 400, message: '标题/条件/建议必填' });
  await db.execute('INSERT INTO farming_rules (title,task_type,conditions,suggestion,priority) VALUES (?,?,?,?,?)',
    [title.trim(), task_type||'other', JSON.stringify(conditions), suggestion.trim(), priority||0]);
  res.json({ code: 0, message: '规则已添加' });
}));

router.put('/rules/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { title, task_type, conditions, suggestion, priority } = req.body;
  await db.execute('UPDATE farming_rules SET title=?,task_type=?,conditions=?,suggestion=?,priority=? WHERE id=?',
    [title.trim(), task_type||'other', JSON.stringify(conditions), suggestion.trim(), priority||0, req.params.id]);
  res.json({ code: 0, message: '规则已更新' });
}));

router.patch('/rules/:id/toggle', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  await db.execute('UPDATE farming_rules SET is_active=? WHERE id=?', [req.body.is_active?1:0, req.params.id]);
  res.json({ code: 0, message: req.body.is_active?'已启用':'已禁用' });
}));

// ── 分析引擎 ──
router.post('/analyze', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { soil_moisture, crop_stage } = req.body || {};
  var w = weatherCache || { temp: 22, humidity: 65, wind_speed: 2, weather_text: '多云', rain_3day: true, rain_5day: false };
  var [rules] = await db.execute('SELECT * FROM farming_rules WHERE is_active=1');
  var soil = { moisture: soil_moisture, crop_stage: crop_stage };

  var matched = rules.filter(function(r) {
    var c = r.conditions;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch(e) { return false; } }
    if (c.temp_min !== undefined && w.temp < c.temp_min) return false;
    if (c.temp_max !== undefined && w.temp > c.temp_max) return false;
    if (c.humidity_min !== undefined && w.humidity < c.humidity_min) return false;
    if (c.wind_min !== undefined && w.wind_speed < c.wind_min) return false;
    if (c.wind_max !== undefined && w.wind_speed > c.wind_max) return false;
    if (c.rain_3day !== undefined && w.rain_3day !== c.rain_3day) return false;
    if (c.rain_5day !== undefined && w.rain_5day !== c.rain_5day) return false;
    if (c.weather_type && w.weather_text.indexOf(c.weather_type) < 0 && c.weather_type !== w.weather_text) return false;
    if (c.soil_moisture !== undefined && soil.moisture !== c.soil_moisture) return false;
    if (c.crop_stage !== undefined && soil.crop_stage !== c.crop_stage) return false;
    return true;
  }).map(function(r) {
    return { id: r.id, title: r.title, task_type: r.task_type, suggestion: r.suggestion, priority: r.priority };
  }).sort(function(a, b) { return b.priority - a.priority; });

  res.json({ code: 0, data: { weather: w, soil_input: soil, matched: matched, count: matched.length } });
}));

// ── 报告发布 ──
router.post('/report', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var suggestions = req.body.suggestions;
  if (!suggestions || !suggestions.length) return res.status(400).json({ code: 400, message: '至少选一条建议' });
  var today = new Date().toISOString().slice(0, 10);
  var wj = JSON.stringify(req.body.weather || {});
  var sj = JSON.stringify(req.body.soil_input || {});
  var gj = JSON.stringify(suggestions);
  await db.execute(
    'INSERT INTO farming_reports (report_date,weather,soil_input,suggestions,status,created_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE weather=?,soil_input=?,suggestions=?,status=?',
    [today, wj, sj, gj, 'published', req.admin.id, wj, sj, gj, 'published']);
  res.json({ code: 0, message: '农事报告已发布' });
}));

router.get('/report/today', wrap(async (req, res) => {
  var today = new Date().toISOString().slice(0, 10);
  var [rows] = await db.execute('SELECT report_date,weather,soil_input,suggestions FROM farming_reports WHERE report_date=? AND status=?', [today, 'published']);
  if (!rows.length) return res.json({ code: 0, data: null });
  var r = rows[0];
  try { r.weather = JSON.parse(r.weather); } catch(e) {}
  try { r.suggestions = JSON.parse(r.suggestions); } catch(e) {}
  res.json({ code: 0, data: r });
}));

module.exports = router;
