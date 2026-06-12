// routes/farming.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// 天气缓存
let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_TTL = 30 * 60 * 1000;

// GET /api/farming/weather — 获取实时天气
router.get('/weather', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const now = Date.now();
  if (weatherCache && (now - weatherCacheTime) < WEATHER_TTL) {
    return res.json({ code: 0, data: weatherCache, cached: true });
  }

  const apiKey = process.env.QWEATHER_KEY;
  const cityId = process.env.QWEATHER_CITY || '101251401';

  if (!apiKey || apiKey === 'your_qweather_key') {
    const mock = {
      temp: 22, feels_like: 21, humidity: 65, wind_speed: 2,
      weather_type: 'cloudy', weather_text: '多云',
      rain_3day: true, rain_5day: false,
      updated: new Date().toISOString()
    };
    weatherCache = mock;
    weatherCacheTime = now;
    return res.json({ code: 0, data: mock, mock: true });
  }

  try {
    const [nowRes, dayRes] = await Promise.all([
      fetch('https://devapi.qweather.com/v7/weather/now?location=' + cityId + '&key=' + apiKey).then(r => r.json()),
      fetch('https://devapi.qweather.com/v7/weather/7d?location=' + cityId + '&key=' + apiKey).then(r => r.json())
    ]);

    const nowData = nowRes.now || {};
    const daily = dayRes.daily || [];

    let rain3 = false, rain5 = false;
    daily.slice(0, 3).forEach(function(d) { if (d.textDay && d.textDay.indexOf('雨') >= 0) rain3 = true; });
    daily.slice(0, 5).forEach(function(d) { if (d.textDay && d.textDay.indexOf('雨') >= 0) rain5 = true; });

    const weather = {
      temp: parseFloat(nowData.temp) || 0,
      feels_like: parseFloat(nowData.feelsLike) || 0,
      humidity: parseFloat(nowData.humidity) || 0,
      wind_speed: parseFloat(nowData.windSpeed) || 0,
      weather_type: nowData.text || '',
      weather_text: nowData.text || '',
      rain_3day: rain3,
      rain_5day: rain5,
      updated: new Date().toISOString()
    };

    weatherCache = weather;
    weatherCacheTime = now;
    res.json({ code: 0, data: weather });
  } catch (e) {
    if (weatherCache) return res.json({ code: 0, data: weatherCache, cached: true });
    res.status(500).json({ code: 500, message: '天气获取失败' });
  }
}));

// ── 规则 CRUD ──

// GET /api/farming/rules
router.get('/rules', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, task_type, conditions, suggestion, priority, is_active FROM farming_rules ORDER BY priority DESC'
  );
  rows.forEach(function(r) { try { r.conditions = JSON.parse(r.conditions); } catch(e) {} });
  res.json({ code: 0, data: rows });
}));

// POST /api/farming/rules
router.post('/rules', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { title, task_type, conditions, suggestion, priority } = req.body;
  if (!title || !conditions || !suggestion) return res.status(400).json({ code: 400, message: '标题、条件、建议不能为空' });
  const [result] = await db.execute(
    'INSERT INTO farming_rules (title, task_type, conditions, suggestion, priority) VALUES (?,?,?,?,?)',
    [title.trim(), task_type || 'other', JSON.stringify(conditions), suggestion.trim(), priority || 0]
  );
  res.json({ code: 0, message: '规则已添加', data: { id: result.insertId } });
}));

// PUT /api/farming/rules/:id
router.put('/rules/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { title, task_type, conditions, suggestion, priority } = req.body;
  await db.execute(
    'UPDATE farming_rules SET title=?, task_type=?, conditions=?, suggestion=?, priority=? WHERE id=?',
    [title.trim(), task_type || 'other', JSON.stringify(conditions), suggestion.trim(), priority || 0, req.params.id]
  );
  res.json({ code: 0, message: '规则已更新' });
}));

// PATCH /api/farming/rules/:id/toggle
router.patch('/rules/:id/toggle', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  await db.execute('UPDATE farming_rules SET is_active=? WHERE id=?', [req.body.is_active ? 1 : 0, req.params.id]);
  res.json({ code: 0, message: req.body.is_active ? '已启用' : '已禁用' });
}));

// ── 分析引擎 ──

// POST /api/farming/analyze
router.post('/analyze', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { soil_moisture, crop_stage } = req.body || {};

  let weather = weatherCache;
  if (!weather) {
    weather = { temp: 22, humidity: 65, wind_speed: 2, weather_text: '多云', rain_3day: true, rain_5day: false };
  }

  const [rules] = await db.execute(
    'SELECT id, title, task_type, conditions, suggestion, priority FROM farming_rules WHERE is_active=1'
  );

  const soil = { moisture: soil_moisture, crop_stage: crop_stage };

  const matched = rules.filter(function(r) {
    var c;
    c = r.conditions; if (typeof c === "string") { try { c = JSON.parse(c); } catch(e) { return false; } }
    if (c.temp_min !== undefined && weather.temp < c.temp_min) return false;
    if (c.temp_max !== undefined && weather.temp > c.temp_max) return false;
    if (c.humidity_min !== undefined && weather.humidity < c.humidity_min) return false;
    if (c.wind_min !== undefined && weather.wind_speed < c.wind_min) return false;
    if (c.wind_max !== undefined && weather.wind_speed > c.wind_max) return false;
    if (c.rain_3day !== undefined && weather.rain_3day !== c.rain_3day) return false;
    if (c.rain_5day !== undefined && weather.rain_5day !== c.rain_5day) return false;
    if (c.weather_type && weather.weather_text.indexOf(c.weather_type) < 0 && c.weather_type !== weather.weather_text) return false;
    if (c.soil_moisture !== undefined && soil.moisture !== c.soil_moisture) return false;
    if (c.crop_stage !== undefined && soil.crop_stage !== c.crop_stage) return false;
    return true;
  }).map(function(r) {
    return { id: r.id, title: r.title, task_type: r.task_type, suggestion: r.suggestion, priority: r.priority };
  });

  matched.sort(function(a, b) { return b.priority - a.priority; });

  res.json({ code: 0, data: { weather: weather, soil_input: soil, matched: matched, count: matched.length } });
}));

// ── 报告发布 ──

// POST /api/farming/report
router.post('/report', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  var suggestions = req.body.suggestions;
  if (!suggestions || !suggestions.length) return res.status(400).json({ code: 400, message: '请至少选择一条建议' });
  var today = new Date().toISOString().slice(0, 10);
  var weatherJson = JSON.stringify(req.body.weather || {});
  var soilJson = JSON.stringify(req.body.soil_input || {});
  var sugJson = JSON.stringify(suggestions);
  await db.execute(
    'INSERT INTO farming_reports (report_date, weather, soil_input, suggestions, status, created_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE weather=?, soil_input=?, suggestions=?, status=?',
    [today, weatherJson, soilJson, sugJson, 'published', req.admin.id, weatherJson, soilJson, sugJson, 'published']
  );
  res.json({ code: 0, message: '农事报告已发布' });
}));

// GET /api/farming/report/today — 村民端公开
router.get('/report/today', wrap(async (req, res) => {
  var today = new Date().toISOString().slice(0, 10);
  const [rows] = await db.execute(
    'SELECT report_date, weather, soil_input, suggestions FROM farming_reports WHERE report_date=? AND status=?',
    [today, 'published']
  );
  if (!rows.length) return res.json({ code: 0, data: null });
  var r = rows[0];
  try { r.weather = JSON.parse(r.weather); } catch(e) {}
  try { r.suggestions = JSON.parse(r.suggestions); } catch(e) {}
  try { r.soil_input = JSON.parse(r.soil_input); } catch(e) {}
  res.json({ code: 0, data: r });
}));

module.exports = router;
