// routes/announcements.js
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authMiddleware, requireSuper } = require('../middleware/auth');

// 上传目录
const NOTICE_DIR = path.join(__dirname, '../uploads/notices');
if (!fs.existsSync(NOTICE_DIR)) fs.mkdirSync(NOTICE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, NOTICE_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.mimetype.startsWith('audio') ? '.webm' : '.jpg');
      cb(null, `notice_${Date.now()}_${Math.random().toString(36).slice(2,5)}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// GET — 公开，无需登录
router.get('/', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, content, tag_type, image_urls, audio_url, audio_type, created_at FROM announcements WHERE is_active=1 ORDER BY created_at DESC LIMIT 20'
  );
  rows.forEach(r => {
    if (r.image_urls) { try { r.image_urls = JSON.parse(r.image_urls); } catch(e) { r.image_urls = []; } }
    else r.image_urls = [];
  });
  res.json({ code: 0, data: rows });
});

// POST — 仅超管，支持图片+录音
router.post('/', authMiddleware, requireSuper,
  upload.fields([{ name: 'images', maxCount: 9 }, { name: 'audio', maxCount: 1 }]),
  async (req, res) => {
    const { title, content, tag_type, audio_type } = req.body;
    if (!title || !content) return res.status(400).json({ code: 400, message: '标题和内容必填' });

    // 处理图片
    let image_urls = null;
    if (req.files && req.files.images && req.files.images.length) {
      image_urls = JSON.stringify(req.files.images.map(f => `/uploads/notices/${f.filename}`));
    }

    // 处理音频
    let audio_url = null;
    let finalAudioType = null;
    if (req.files && req.files.audio && req.files.audio.length) {
      audio_url = `/uploads/notices/${req.files.audio[0].filename}`;
      finalAudioType = 'record';
    } else if (audio_type === 'tts') {
      finalAudioType = 'tts';
    }

    await db.execute(
      'INSERT INTO announcements (title, content, tag_type, image_urls, audio_url, audio_type, created_by) VALUES (?,?,?,?,?,?,?)',
      [title.trim(), content.trim(), tag_type || '全村告示', image_urls, audio_url, finalAudioType, req.admin.id]
    );
    res.json({ code: 0, message: '公告发布成功' });
  }
);

// DELETE — 仅超管
router.delete('/:id', authMiddleware, requireSuper, async (req, res) => {
  await db.execute('UPDATE announcements SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '公告已撤回' });
});

module.exports = router;
