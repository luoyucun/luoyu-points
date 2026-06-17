-- 罗峪村村民积分系统 - 数据库建表脚本
-- 15张表，导出日期 2026-06-15

DROP TABLE IF EXISTS `admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admins` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录用户名',
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'bcrypt 哈希密码',
  `name` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '真实姓名',
  `role` enum('super','village_admin','group_leader') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'group_leader' COMMENT 'super=超管, village_admin=村干部, group_leader=组长',
  `group_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '组长所属组（村干部填NULL）',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账户';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `announcements`
--

DROP TABLE IF EXISTS `announcements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `announcements` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_urls` text COLLATE utf8mb4_unicode_ci,
  `audio_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `audio_type` enum('record','tts') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_type` enum('活动通知','体育活动','政策宣传','全村告示') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '全村告示',
  `created_by` int(10) unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `announcements_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkin_events`
--

DROP TABLE IF EXISTS `checkin_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `checkin_events` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '签到活动名称',
  `score_event_id` int(10) unsigned DEFAULT NULL COMMENT '关联的积分事件',
  `score_points` int(11) NOT NULL DEFAULT '5' COMMENT '签到成功加分值',
  `qr_token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '二维码唯一标识',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int(10) unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expired_at` datetime DEFAULT NULL COMMENT '签到截止时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `qr_token` (`qr_token`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签到活动';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkin_records`
--

DROP TABLE IF EXISTS `checkin_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `checkin_records` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `checkin_event_id` int(10) unsigned NOT NULL,
  `villager_id` int(10) unsigned NOT NULL,
  `score_record_id` int(10) unsigned DEFAULT NULL COMMENT '关联的积分记录',
  `photo_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '签到现场照片',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ev_villager` (`checkin_event_id`,`villager_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签到记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `crop_config`
--

DROP TABLE IF EXISTS `crop_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `crop_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `crop_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '作物名称',
  `planting_date` date DEFAULT NULL COMMENT '播种日期',
  `notes` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='村庄作物配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `exchange_records`
--

DROP TABLE IF EXISTS `exchange_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `exchange_records` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `villager_id` int(10) unsigned NOT NULL,
  `goods_id` int(10) unsigned NOT NULL,
  `goods_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `points_cost` int(10) unsigned NOT NULL,
  `status` enum('pending','done','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `villager_id` (`villager_id`),
  KEY `goods_id` (`goods_id`),
  CONSTRAINT `exchange_records_ibfk_1` FOREIGN KEY (`villager_id`) REFERENCES `villagers` (`id`),
  CONSTRAINT `exchange_records_ibfk_2` FOREIGN KEY (`goods_id`) REFERENCES `goods` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='兑换记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `farming_reports`
--

DROP TABLE IF EXISTS `farming_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `farming_reports` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `report_date` date NOT NULL,
  `weather` json DEFAULT NULL COMMENT '天气数据快照',
  `soil_input` json DEFAULT NULL COMMENT '管理员土壤输入',
  `suggestions` json DEFAULT NULL COMMENT '匹配建议列表',
  `status` enum('draft','published') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `report_date` (`report_date`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日农事报告';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `farming_rules`
--

DROP TABLE IF EXISTS `farming_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `farming_rules` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '建议标题',
  `task_type` enum('plant','pest','weed','harvest','irrigate','other') COLLATE utf8mb4_unicode_ci DEFAULT 'other',
  `conditions` json NOT NULL COMMENT '触发条件JSON',
  `suggestion` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '农事建议内容',
  `priority` int(11) DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='农事规则';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `feedback`
--

DROP TABLE IF EXISTS `feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `feedback` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `villager_name` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '留言人姓名（可匿名）',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '反馈内容',
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='村民反馈建议';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `goods`
--

DROP TABLE IF EXISTS `goods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `goods` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `icon` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '?' COMMENT 'emoji图标',
  `points_cost` int(10) unsigned NOT NULL COMMENT '兑换所需积分',
  `stock` int(10) unsigned NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='可兑换物资';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reset_log`
--

DROP TABLE IF EXISTS `reset_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `reset_log` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `reset_year` int(10) unsigned NOT NULL COMMENT '清零年份',
  `villagers_count` int(10) unsigned NOT NULL COMMENT '影响的村民数',
  `triggered_by` enum('auto','manual') COLLATE utf8mb4_unicode_ci NOT NULL,
  `admin_id` int(10) unsigned DEFAULT NULL COMMENT '手动触发者',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='年度清零日志';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `score_events`
--

DROP TABLE IF EXISTS `score_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `score_events` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件名称',
  `category` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '党建引领/体育特色/生态保护/公共参与/互帮互助/特殊贡献/扣分项目',
  `points` int(11) NOT NULL COMMENT '正数=加分，负数=扣分',
  `verify_method` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '验证方式说明',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分事件配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `score_records`
--

DROP TABLE IF EXISTS `score_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `score_records` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `villager_id` int(10) unsigned NOT NULL,
  `event_id` int(10) unsigned DEFAULT NULL,
  `event_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余存储，防止事件改名后记录失真',
  `points` int(11) NOT NULL COMMENT '实际分值（含正负）',
  `show_in_feed` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否在村民端动态/明细中展示',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '情况文字说明',
  `image_urls` json DEFAULT NULL COMMENT '图片URL数组，存OSS路径',
  `submitted_by` int(10) unsigned NOT NULL COMMENT '录入人admin.id',
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved' COMMENT 'village_admin录入直接approved；group_leader录入为pending',
  `reviewed_by` int(10) unsigned DEFAULT NULL COMMENT '审核人admin.id',
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_revoked` tinyint(1) NOT NULL DEFAULT '0',
  `revoked_by` int(10) unsigned DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `revoke_reason` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_villager` (`villager_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `score_records_ibfk_1` FOREIGN KEY (`villager_id`) REFERENCES `villagers` (`id`),
  CONSTRAINT `score_records_ibfk_2` FOREIGN KEY (`event_id`) REFERENCES `score_events` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分变动记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_config`
--

DROP TABLE IF EXISTS `system_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `system_config` (
  `cfg_key` varchar(50) NOT NULL,
  `cfg_value` varchar(255) NOT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cfg_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `villagers`
--

DROP TABLE IF EXISTS `villagers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `villagers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '姓名',
  `gender` enum('男','女') COLLATE utf8mb4_unicode_ci NOT NULL,
  `group_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '村民小组，如：第一组',
  `id_last4` char(4) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '身份证后4位',
  `first_login_bonus` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已领取首次登录积分',
  `total_score` int(11) NOT NULL DEFAULT '0' COMMENT '当前累计积分',
  `honor_score` int(11) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group` (`group_no`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=1757 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='村民信息';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-17 10:20:49
