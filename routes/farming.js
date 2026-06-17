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

    // 3日预报
    var forecast = daily.slice(0, 3).map(function(d) {
      return {
        date: d.date,
        high: parseFloat(d.high) || 0,
        low: parseFloat(d.low) || 0,
        text_day: d.text_day || '',
        text_night: d.text_night || '',
        humidity: parseFloat(d.humidity) || 0,
        wind_scale: d.wind_scale || '',
        wind_speed: parseFloat(d.wind_speed) || 0,
        rainfall: parseFloat(d.rainfall) || 0
      };
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
      forecast: forecast,
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


// ── 作物配置 CRUD ──
router.get('/crops', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var [rows] = await db.execute('SELECT id,crop_name,planting_date,notes,is_active FROM crop_config ORDER BY id');
  rows.forEach(function(r) { if (r.planting_date) r.planting_date = r.planting_date.toISOString().slice(0,10); });
  res.json({ code: 0, data: rows });
}));

router.post('/crops', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { crop_name, planting_date, notes } = req.body;
  if (!crop_name) return res.status(400).json({ code: 400, message: '作物名称必填' });
  await db.execute('INSERT INTO crop_config (crop_name,planting_date,notes) VALUES (?,?,?)',
    [crop_name.trim(), planting_date || null, notes || null]);
  res.json({ code: 0, message: '作物已添加' });
}));

router.put('/crops/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { crop_name, planting_date, notes } = req.body;
  await db.execute('UPDATE crop_config SET crop_name=?,planting_date=?,notes=? WHERE id=?',
    [crop_name.trim(), planting_date || null, notes || null, req.params.id]);
  res.json({ code: 0, message: '作物已更新' });
}));

router.delete('/crops/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  await db.execute('DELETE FROM crop_config WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '作物已删除' });
}));

// POST /api/farming/parse-crops — 自然语言解析作物
router.post('/parse-crops', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var text = req.body.text || '';
  var crops = [];
  // 匹配模式：早稻/晚稻/中稻/油菜/柑橘/茶叶/玉米/烟草 等 + 可选日期
  var knownCrops = ['早稻','晚稻','中稻','油菜','柑橘','茶叶','烟草','黄蜀葵','玉米','大棚番茄','大棚辣椒','棉花'];
  knownCrops.forEach(function(c) {
    if (text.indexOf(c) >= 0) {
      var dateMatch = text.match(new RegExp(c + '[^0-9]*(\\d{1,2})[月\\.](\\d{1,2})'));
      var planting = null;
      if (dateMatch) {
        var m = dateMatch[1].padStart(2,'0'), d = dateMatch[2].padStart(2,'0');
        planting = '2026-' + m + '-' + d;
      }
      crops.push({ crop_name: c, planting_date: planting });
    }
  });
  if (!crops.length) return res.json({ code: 0, data: [], message: '未识别到已知作物，请手动添加' });
  // 保存到数据库
  for (var i = 0; i < crops.length; i++) {
    var c = crops[i];
    await db.execute('INSERT INTO crop_config (crop_name,planting_date) VALUES (?,?) ON DUPLICATE KEY UPDATE planting_date=VALUES(planting_date)',
      [c.crop_name, c.planting_date]);
  }
  res.json({ code: 0, data: crops, message: '已识别并保存 ' + crops.length + ' 种作物' });
}));

// ── 分析引擎 ──
router.post('/analyze', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var { soil_moisture, crop_stage } = req.body || {};
  var w = weatherCache || { temp: 22, humidity: 65, wind_speed: 2, weather_text: '多云', rain_3day: true, rain_5day: false };
  var [cropRows] = await db.execute("SELECT crop_name FROM crop_config WHERE is_active=1");
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
    return { id: r.id, title: r.title, task_type: r.task_type, suggestion: r.suggestion, priority: r.priority, source: "custom" };
  }).sort(function(a, b) { return b.priority - a.priority; });
  var cropNames = cropRows.map(function(c){ return c.crop_name; });
  var kbRules = matchKnowledgeBaseRules(w, soil, cropNames);
  matched = matched.concat(kbRules);

  res.json({ code: 0, data: { weather: w, soil_input: soil, matched: matched, count: matched.length, crops: cropRows.map(function(c){ return c.crop_name; }) } });
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

// ── 知识库规则匹配 ──
function matchKnowledgeBaseRules(w, soil, cropList) {
  var results = [];
  if (!cropList.length) return results;

  // 通用施药窗口
  var ws = parseInt(w.wind_scale) || 0;
  if (ws <= 3 && w.temp < 30 && w.humidity > 65 && w.forecast && w.forecast[1] && (w.forecast[1].rainfall || 0) < 10) {
    results.push({ title: '施药窗口有效', task_type: 'other', priority: 6, suggestion: '当前天气适宜施药：风力≤3级、气温<30°C、湿度>65%、明日无中雨。', source: 'kb' });
  }
  if (ws >= 4 || w.temp > 33) {
    results.push({ title: '不宜施药', task_type: 'other', priority: 5, suggestion: '不宜施药，等待窗口', source: 'kb' });
  }

  // 水稻类
  var hasRice = cropList.some(function(c) { return c.indexOf('稻') >= 0; });
  if (hasRice) {
    if (w.temp < 20) results.push({ title: '低温僵苗风险', task_type: 'other', priority: 9, suggestion: '低温僵苗，浅水保温', source: 'kb' });
    if (w.temp > 35) results.push({ title: '高温热害风险', task_type: 'irrigate', priority: 10, suggestion: '高温热害，加深水层降温', source: 'kb' });
    if (w.temp >= 28 && w.temp <= 32 && w.humidity >= 80 && ws <= 3) results.push({ title: '稻飞虱迁入风险', task_type: 'pest', priority: 10, suggestion: '稻飞虱高发，请杀灭虫害', source: 'kb' });
    if (w.temp >= 22 && w.temp <= 28 && w.humidity >= 90 && w.rain_3day) results.push({ title: '叶瘟暴发风险', task_type: 'pest', priority: 10, suggestion: '叶瘟风险，喷药排水', source: 'kb' });
    if (ws >= 6) results.push({ title: '倒伏风险', task_type: 'other', priority: 10, suggestion: '大风倒伏风险，加固护根', source: 'kb' });
    if (w.temp >= 35 && w.humidity <= 40 && ws >= 4) results.push({ title: '干热风危害', task_type: 'irrigate', priority: 10, suggestion: '干热风危害，灌水保墒', source: 'kb' });
    if (!w.rain_3day && w.temp >= 18 && w.temp <= 28 && w.humidity < 75) results.push({ title: '收获晾晒窗口', task_type: 'harvest', priority: 7, suggestion: '适宜收割晾晒', source: 'kb' });
  }

  // 油菜
  if (cropList.indexOf('油菜') >= 0) {
    if (w.temp < 5) results.push({ title: '油菜低温冻害', task_type: 'other', priority: 10, suggestion: '油菜冻害风险，喷施保花', source: 'kb' });
    if (w.temp >= 15 && w.temp <= 22 && w.humidity >= 85 && w.rain_3day) results.push({ title: '菌核病暴发', task_type: 'pest', priority: 10, suggestion: '菌核病高发，喷药排水', source: 'kb' });
  }

  // 茶叶
  if (cropList.indexOf('茶叶') >= 0) {
    if (w.temp >= 25 && w.temp <= 30 && w.humidity >= 80 && ws <= 3) results.push({ title: '茶小绿叶蝉风险', task_type: 'pest', priority: 8, suggestion: '茶小绿叶蝉，请及时喷防', source: 'kb' });
  }

  // 柑橘
  if (cropList.indexOf('柑橘') >= 0) {
    if (w.temp < 10) results.push({ title: '柑橘花芽受阻', task_type: 'other', priority: 9, suggestion: '柑橘低温，培土保温', source: 'kb' });
    if (w.temp >= 25 && w.temp <= 30 && w.precip > 25 && ws >= 5) results.push({ title: '溃疡病风雨传播', task_type: 'pest', priority: 9, suggestion: '溃疡病风险，喷药预防', source: 'kb' });
  }

  // 玉米
  if (cropList.indexOf('玉米') >= 0) {
    if (w.temp < 18) results.push({ title: '玉米生长迟缓', task_type: 'other', priority: 7, suggestion: '玉米低温生长慢，喷施促长', source: 'kb' });
    if (w.temp > 33) results.push({ title: '玉米花粉败育', task_type: 'irrigate', priority: 9, suggestion: '玉米高温，灌水降温', source: 'kb' });
  }

  // 大棚作物
  var hasGreenhouse = cropList.some(function(c) { return c.indexOf('大棚') >= 0; });
  if (hasGreenhouse && (ws >= 6)) {
    results.push({ title: '大风棚膜风险', task_type: 'other', priority: 10, suggestion: '大风风险，加固大棚', source: 'kb' });
  }

  return results;
}
