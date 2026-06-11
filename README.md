# 罗峪村村民积分系统

桑植县凉水口镇罗峪村 · 数字化乡村治理积分管理平台

## 功能概览

### 村民端（公开浏览 + 个人中心）

- **无需登录即可浏览**：村务公告、积分排行（总分/本月）、积分动态、积分细则
- **个人中心**：姓名+身份证后4位登录，查看个人积分（兑换积分+荣誉积分）、积分明细、组内排名
- **兑换商城**：积分兑换生活物资，村干部确认发放
- **扫码签到**：线下活动扫码签到自动加分，现场拍照留证
- **年度清零**：兑换积分每年1月10日自动清零，荣誉积分永久保留

### 管理后台

- **数据总览**：全村积分统计、各组排行、库存预警、年度清零操作
- **村民管理**：增删改查、按姓名/组别筛选、分页浏览
- **积分管理**：单人/批量录入、审核（通过/拒绝）、撤回（超管）
- **积分规则**：灵活配置积分事件和类别，村民端自动同步
- **签到管理**：创建签到活动、生成二维码、查看签到名单和现场照片
- **兑换管理**：兑换窗口开关、物资管理、发放确认
- **公告管理**：富文本公告发布（支持图片+录音+TTS语音播报）
- **村民反馈**：匿名/实名建议收集

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Node.js 18 + Express 4 |
| 数据库 | MySQL 8.0（utf8mb4） |
| 前端 | 原生 HTML/CSS/JS（无框架） |
| 图标 | Tabler Icons |
| 二维码 | QRCode.js |
| 进程管理 | PM2 |
| 反向代理 | Nginx（宝塔面板） |
| 定时任务 | node-cron |

## 项目结构

```
/
├── app.js                    # 服务入口
├── package.json
├── schema.sql                # 数据库建表脚本
├── .env                      # 环境变量（不入库）
├── index.html                # 村民端 SPA + 管理端轻量版
├── admin.html                # 桌面管理后台
├── routes/
│   ├── admin.js              # 仪表盘/批量录入/清零/规则CRUD
│   ├── scores.js             # 积分录入/审核/事件列表
│   ├── villagers.js          # 村民登录/查询/排行
│   ├── checkin.js            # 扫码签到系统
│   ├── exchange.js           # 兑换流程
│   ├── announcements.js      # 公告CRUD（富媒体）
│   ├── public.js             # 公开API：红黑榜/排行/反馈
│   ├── auth.js               # 管理员登录
│   └── admins.js             # 管理员账户管理
├── middleware/
│   └── auth.js               # JWT认证 + 三级RBAC
├── config/
│   ├── db.js                 # MySQL连接池
│   └── oss.js                # 阿里云OSS（可选）
└── uploads/                  # 本地文件存储
```

## 数据库

### 核心表

| 表 | 说明 |
|---|------|
| `admins` | 管理员（super / village_admin / group_leader） |
| `villagers` | 村民档案（兑换积分 + 荣誉积分双轨制） |
| `score_events` | 积分事件配置（28项，支持自定义类别） |
| `score_records` | 积分变动流水（支持撤回、展示控制） |
| `goods` | 兑换物资 |
| `exchange_records` | 兑换记录 |
| `announcements` | 村务公告（图片+音频富媒体） |
| `checkin_events` | 签到活动 |
| `checkin_records` | 签到记录（含现场照片） |
| `reset_log` | 年度积分清零日志 |
| `feedback` | 村民反馈建议 |
| `system_config` | KV系统配置 |

## 快速部署

```bash
# 1. 克隆仓库
git clone git@github.com:luoyucun/luoyu-points.git
cd luoyu-points

# 2. 安装依赖
npm install

# 3. 创建数据库
mysql -u root -p < schema.sql

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 填入数据库密码和JWT密钥

# 5. 启动服务
pm2 start app.js --name luoyu-backend

# 6. 配置Nginx（示例）
# root /path/to/luoyu-points;
# location /api/ { proxy_pass http://127.0.0.1:3000; }
# location /uploads/ { proxy_pass http://127.0.0.1:3000; }
```

## 默认账户

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 超级管理员 | admin | luoyu2026 |

> 上线后请立即修改默认密码。

## 积分双轨制

- **兑换积分**（total_score）：可用于兑换物资，每年1月10日自动清零
- **荣誉积分**（honor_score）：累计不扣减，永久保留，反映历史贡献

## 许可

内部项目，村委所有。
