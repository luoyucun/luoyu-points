require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

// CORS 全开，方便H5访问
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 图片静态文件服务（由Node.js直接提供，绕过Nginx路径问题）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/villagers',     require('./routes/villagers'));
app.use('/api/scores',        require('./routes/scores'));
app.use('/api/admins',        require('./routes/admins'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/exchange',      require('./routes/exchange'));
app.use('/api/admin', require('./routes/admin'));

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误，请稍后重试' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`罗峪村积分系统后端运行在端口 ${PORT}`));
