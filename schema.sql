-- ============================================================
-- 罗峪村村民积分系统 · 数据库建表脚本
-- 数据库：阿里云 RDS MySQL 8.0
-- ============================================================

CREATE DATABASE IF NOT EXISTS luoyu_points
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE luoyu_points;

-- ------------------------------------------------------------
-- 1. 管理员表
-- ------------------------------------------------------------
CREATE TABLE admins (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(50)  NOT NULL UNIQUE COMMENT '登录用户名',
  password    VARCHAR(255) NOT NULL       COMMENT 'bcrypt 哈希密码',
  name        VARCHAR(30)  NOT NULL       COMMENT '真实姓名',
  role        ENUM('super','village_admin','group_leader') NOT NULL DEFAULT 'group_leader'
              COMMENT 'super=超管, village_admin=村干部, group_leader=组长',
  group_no    VARCHAR(20)  DEFAULT NULL   COMMENT '组长所属组（村干部填NULL）',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT '管理员账户';

-- ------------------------------------------------------------
-- 2. 村民表
-- ------------------------------------------------------------
CREATE TABLE villagers (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(30)  NOT NULL       COMMENT '姓名',
  gender      ENUM('男','女') NOT NULL,
  group_no    VARCHAR(20)  NOT NULL       COMMENT '村民小组，如：第一组',
  id_last4    CHAR(4)      NOT NULL       COMMENT '身份证后4位',
  total_score INT          NOT NULL DEFAULT 0 COMMENT '当前累计积分',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_group (group_no),
  INDEX idx_name  (name)
) COMMENT '村民信息';

-- ------------------------------------------------------------
-- 3. 积分事件配置表（16加分 + 4扣分）
-- ------------------------------------------------------------
CREATE TABLE score_events (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(50)  NOT NULL COMMENT '事件名称',
  category      VARCHAR(20)  NOT NULL COMMENT '党建引领/体育特色/生态保护/公共参与/互帮互助/特殊贡献/扣分项目',
  points        INT          NOT NULL COMMENT '正数=加分，负数=扣分',
  verify_method VARCHAR(100) DEFAULT NULL COMMENT '验证方式说明',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0
) COMMENT '积分事件配置';

-- 写入默认事件
INSERT INTO score_events (name, category, points, verify_method, sort_order) VALUES
('党日活动签到',   '党建引领', 5,   '扫码或管理员确认', 1),
('组织生活参与',   '党建引领', 10,  '管理员确认',       2),
('志愿服务',       '党建引领', 15,  '照片或管理员确认', 3),
('参加体育活动',   '体育特色', 10,  '签到或管理员确认', 4),
('组织体育活动',   '体育特色', 20,  '活动通知+照片',    5),
('指导体育练习',   '体育特色', 15,  '活动通知+照片',    6),
('参加环境清扫',   '生态保护', 5,   '管理员确认',       7),
('参加植树造林',   '生态保护', 10,  '照片或管理员确认', 8),
('庭院美化示范户', '生态保护', 15,  '村干部评定',       9),
('参加村级活动',   '公共参与', 5,   '管理员确认',       10),
('参加公共劳动',   '公共参与', 8,   '管理员确认',       11),
('邻里帮扶',       '互帮互助', 10,  '照片或双方确认',   12),
('关爱老人',       '互帮互助', 10,  '照片或管理员确认', 13),
('配合调解',       '纠纷调解', 10,  '调解档案签字',     14),
('见义勇为',       '特殊贡献', 50,  '村委确认',         15),
('参与建设项目',   '特殊贡献', 5,   '项目组织者确认',   16),
('参与赌博',       '扣分项目', -20, '经村委确认',       17),
('传播邪教',       '扣分项目', -30, '经村委确认',       18),
('乱占耕地',       '扣分项目', -30, '经村委确认',       19),
('优秀学生（校级）', '教育积分', 10, '奖状或学校证明', 21),('优秀学生（区级）', '教育积分', 20, '奖状或教育局证明', 22),('考上大学（本科）', '教育积分', 30, '录取通知书', 23),('考上大学（专科）', '教育积分', 20, '录取通知书', 24),('应征入伍', '军旅积分', 30, '入伍通知书', 25),('部队立功（三等功）', '军旅积分', 50, '立功证书', 26),('部队立功（二等功及以上）', '军旅积分', 100, '立功证书', 27),('光荣退伍', '军旅积分', 10, '退伍证', 28),
('乱堆垃圾不整治', '扣分项目', -10, '经教育不改',       20);

-- ------------------------------------------------------------
-- 4. 积分记录表
-- ------------------------------------------------------------
CREATE TABLE score_records (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  villager_id   INT UNSIGNED NOT NULL,
  event_id      INT UNSIGNED NOT NULL,
  event_name    VARCHAR(50)  NOT NULL   COMMENT '冗余存储，防止事件改名后记录失真',
  points        INT          NOT NULL   COMMENT '实际分值（含正负）',
  description   VARCHAR(500) DEFAULT NULL COMMENT '情况文字说明',
  image_urls    JSON         DEFAULT NULL COMMENT '图片URL数组，存OSS路径',
  submitted_by  INT UNSIGNED NOT NULL   COMMENT '录入人admin.id',
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'
                COMMENT 'village_admin录入直接approved；group_leader录入为pending',
  reviewed_by   INT UNSIGNED DEFAULT NULL COMMENT '审核人admin.id',
  reviewed_at   DATETIME     DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_villager   (villager_id),
  INDEX idx_status     (status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (villager_id) REFERENCES villagers(id),
  FOREIGN KEY (event_id)    REFERENCES score_events(id)
) COMMENT '积分变动记录';

-- ------------------------------------------------------------
-- 5. 兑换物资表
-- ------------------------------------------------------------
CREATE TABLE goods (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL,
  icon        VARCHAR(10)  DEFAULT '🎁' COMMENT 'emoji图标',
  points_cost INT UNSIGNED NOT NULL COMMENT '兑换所需积分',
  stock       INT UNSIGNED NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0
) COMMENT '可兑换物资';

INSERT INTO goods (name, icon, points_cost, stock, sort_order) VALUES
('洗衣液', '🧴', 20,  48, 1),
('挂面礼包','🍜',30,  36, 2),
('香皂套装','🛁', 25,  60, 3),
('茶苗5株', '🌱',50,  20, 4),
('运动水壶','⚽', 60,  15, 5),
('运动背包','🎒',120,  8, 6);

-- ------------------------------------------------------------
-- 6. 兑换记录表
-- ------------------------------------------------------------
CREATE TABLE exchange_records (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  villager_id INT UNSIGNED NOT NULL,
  goods_id    INT UNSIGNED NOT NULL,
  goods_name  VARCHAR(50)  NOT NULL,
  points_cost INT UNSIGNED NOT NULL,
  status      ENUM('pending','done','cancelled') NOT NULL DEFAULT 'pending',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (villager_id) REFERENCES villagers(id),
  FOREIGN KEY (goods_id)    REFERENCES goods(id)
) COMMENT '兑换记录';

-- ------------------------------------------------------------
-- 7. 公告表
-- ------------------------------------------------------------
CREATE TABLE announcements (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(100) NOT NULL,
  content     TEXT         NOT NULL,
  tag_type    ENUM('活动通知','体育活动','政策宣传','全村告示') NOT NULL DEFAULT '全村告示',
  created_by  INT UNSIGNED NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admins(id)
) COMMENT '公告表';

-- ------------------------------------------------------------
-- 初始超管账户（密码：luoyu2026，需上线后立即修改）
-- bcrypt hash of "luoyu2026"
-- ------------------------------------------------------------
INSERT INTO admins (username, password, name, role) VALUES
('admin', '$2b$10$shihDNwnG/ZV0uyKqinYQeaGxe6I6INccmYjZgH/z.Azqyx9WVSDm', '系统管理员', 'super');
