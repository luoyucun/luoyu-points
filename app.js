
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const db      = require('./config/db');
const app     = express();

// CORS 全开，方便H5访问
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', require('express').static(require('path').join(__dirname, 'uploads')));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/villagers',     require('./routes/villagers'));
app.use('/api/scores',        require('./routes/scores'));
app.use('/api/admins',        require('./routes/admins'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/exchange',      require('./routes/exchange'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/checkin',       require('./routes/checkin'));
app.use('/api/public',        require('./routes/public'));

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误，请稍后重试' });
});

// ── 年度积分清零定时任务：每年1月10日凌晨2:00执行 ──
cron.schedule('0 2 10 1 *', async () => {
  const currentYear = new Date().getFullYear();
  console.log('[CRON] 触发年度积分清零 ' + currentYear);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'UPDATE villagers SET total_score=0 WHERE total_score>0 AND is_active=1'
    );
    const count = result.changedRows;
    await conn.execute(
      'INSERT INTO reset_log (reset_year, villagers_count, triggered_by) VALUES (?,?,"auto")',
      [currentYear, count]
    );
    await conn.commit();
    console.log('[CRON] 积分清零完成，共清零' + count + '位村民的兑换积分');
  } catch(e) {
    await conn.rollback();
    console.error('[CRON] 积分清零失败:', e.message);
  } finally {
    conn.release();
  }
}, {
  timezone: 'Asia/Shanghai'
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('罗峪村积分系统后端运行在端口 ' + PORT));
