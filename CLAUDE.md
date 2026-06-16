# CLAUDE.md — 村级数字化项目记忆档案

> 规则：Claude 每次动手前必须先完整读取本文件，确认红线后再执行。
> 更新：每次重大修改后，由用户或 Claude 同步更新本文件。

---

## 1. 项目概览

| 项目 | 状态 | 备注 |
|------|------|------|
| 罗峪村村民积分系统 | 开发中/V4.0 | 详见第3-4节 |
| 村级水产监测 | 方案确定/待开发 | 单塘预算≤500，电池供电，后续切太阳能 |
| 文档工具 | 已部署 | doocs/md 编辑器 |

**部署环境**：村级现场，手机信号良好。

---

## 2. 系统红线（绝对禁止触碰）

- [ ] **禁止用 sed 批量替换 HTML/JS 文件**——必须用 Python 脚本精确操作，先在服务器验证语法再提交
- [ ] **数据库 ALTER TABLE 必须先在 schema.sql 同步**，然后执行，最后记录到修改日志
- [ ] **禁止在未读取完整文件的情况下做字符串替换**（Python 脚本也要先读后写）
- [ ] **禁止一次 commit 跨多个独立功能模块**
- [ ] **所有输出文件必须带版本号命名**（见第6节）

---

## 3. 罗峪村村民积分系统 — 技术栈

- **前端**：纯 HTML/CSS/JS（index.html ~1700行，admin.html ~2300行），无框架
- **后端**：Node.js 18 + Express 4 + MySQL2
- **数据库**：MySQL 8.0（utf8mb4），14张表
- **服务器**：阿里云 ECS（47.107.31.231），Alibaba Cloud Linux
- **部署**：PM2（luoyu-backend），Nginx 宝塔版，域名 luoyu.goodsport.fun
- **天气**：心知天气 API（HMAC-SHA1 签名），坐标 29.50:109.90（桑植县）
- **认证**：JWT（8h）for admin，姓名+身份证后4位 for villager
- **图标**：Tabler Icons（CDN），QRCode.js

### 关键配置

```
SSH: ssh luoyu (root@47.107.31.231，密钥 ~/.ssh/luoyu.pem)
项目路径: /www/wwwroot/luoyu
MySQL: luoyu_admin / Maxway@53 / luoyu_points
PM2: pm2 restart luoyu-backend
.env不在Git中，密钥不提交
```

---

## 4. 积分系统 — 模块清单

| 模块 | 状态 | 关键文件 |
|------|:---:|------|
| 积分规则管理 | ✅ | admin.html + routes/admin.js |
| 批量录入（≤200人） | ✅ | admin.html + routes/admin.js |
| 扫码签到+拍照留证 | ✅ | routes/checkin.js + index.html |
| 年度积分清零 | ✅ | node-cron 每年1/10 2:00 |
| 公开浏览（公告/排行/动态/细则） | ✅ | index.html pubNav |
| 红黑榜+月度排行 | ✅ | routes/public.js |
| 首次登录送分（10分） | ✅ | routes/villagers.js |
| 村民反馈渠道 | ✅ | routes/public.js |
| 分页（15条/页） | ✅ | admin.html renderPager |
| 村名动态配置 | ✅ | system_config + routes/admin.js vc |
| 黄历+宜忌（农历计算） | ✅ | index.html getLunarInfo() |
| 天气接入（心知3日预报） | ✅ | routes/farming.js |
| 农事规则引擎（17条KB规则） | ✅ | routes/farming.js matchKnowledgeBaseRules |
| 农事配置向导（自然语言解析） | ⚠️ | admin.html（HTML完成，JS待补） |
| 积分双轨制（兑换+荣誉） | ✅ | score_records |
| 物资兑换 | ✅ | routes/exchange.js |
| 公告富媒体（图片+录音+TTS） | ✅ | routes/announcements.js |
| OSS图片存储 | ❌ | 占位符，未配置 |

---

## 5. 文件命名与版本规范

格式：`[项目名称]_[内容描述]_v[版本号].[扩展名]`

- `v0.x`：草案/开发中
- `v1.x`：正式运行，x 为迭代次数
- 重大重构时升主版本号（如 v1→v2）

---

## 6. 最近修改记录

| 日期 | 修改内容 | 涉及文件 |
|------|----------|----------|
| 2026-06-13 | 心知天气切换、作物配置+知识库规则、村名动态配置、admin作物页面 | farming.js, admin.html, index.html |
| 2026-06-12 | 农事日历系统上线（天气+黄历+规则引擎）、和风→心知切换 | farming.js, admin.html, index.html |
| 2026-06-11 | 公开浏览模式、分页系统、底部导航移除 | index.html, admin.html |
| 2026-06-10 | 批量录入、扫码签到、年度清零、积分规则管理 | routes/*, admin.html |

Git标签：`v1.0-stable`, `v20260613-weather`, `v20260613-village-config`

---

## 7. 已知问题与待办

### 待办（按优先级）
- [ ] 补完作物配置页面的 JS 交互逻辑（HTML已有，JS是空壳）
- [ ] 完整知识库规则（50+条→当前只有17条）
- [ ] 积温推算(GDD)模型
- [ ] OSS图片存储配置
- [ ] 村民自助申报积分（用户有顾虑，暂不动）

### 已知问题
- [ ] 天气观测站（桑植县）与凉水口镇可能有微气候偏差
- [ ] admin.html 中 loadVillageConfig 的引号转义脆弱
- [ ] 数据库有直接 ALTER TABLE 修改的历史，未全部同步到 schema.sql

---

## 8. 与 Claude 协作规则（强制遵守）

1. **先读后写**：修改任何文件前，必须先读取该文件完整内容，以及本 `CLAUDE.md`
2. **任务单模式**：一次只处理一个明确任务，禁止顺手修改无关代码
3. **禁止 sed 操作 HTML/JS**：用 Python 脚本精确操作，先在服务器验证语法再提交
4. **小步提交**：每完成一个功能点，立即 `git add` + `git commit`
5. **先方案后代码**：复杂改动先输出修改方案（改哪些文件、改哪几行），用户确认后再写
6. **diff 优先**：展示 diff，用户确认后再写入
7. **不懂就问**：遇到不确定的逻辑，必须询问用户，禁止猜测
8. **15分钟止损**：同一问题尝试两次还不行，立即切换方案

---

## 9. 常用命令

```bash
# 服务器
ssh luoyu
pm2 restart luoyu-backend && pm2 logs luoyu-backend --lines 5 --nostream

# Git
cd /www/wwwroot/luoyu
git status
git add <file> && git commit -m "feat/fix: xxx" && git push origin main

# 数据库
mysql -u luoyu_admin -p'Maxway@53' luoyu_points -e "SELECT ..."

# API测试
curl -s http://localhost:3000/health
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"luoyu2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
curl -s 'http://localhost:3000/api/villagers?page=1&limit=3' -H "Authorization: Bearer $TOKEN"

# 回退
git reset --hard HEAD
```

---

*本文件由用户与 Claude 共同维护，每次重大修改后同步更新。*
*最后更新：2026-06-15*
