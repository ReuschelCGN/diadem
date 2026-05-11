-- Better Auth schema migration for Diadem.
-- Targets upgrades from main schema.
--
-- Usage:
--   mysql -u <user> -p <database> < migrations/001_better_auth.sql
--
-- Fresh installs should use drizzle `db:push`.
--
-- The procedures below give us idempotent DDL (MySQL has no
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). They're dropped at the end.

DELIMITER //

DROP PROCEDURE IF EXISTS diadem_add_col //
CREATE PROCEDURE diadem_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN coldef TEXT)
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
	) THEN
		SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', coldef);
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
	END IF;
END //

DROP PROCEDURE IF EXISTS diadem_drop_col //
CREATE PROCEDURE diadem_drop_col(IN tbl VARCHAR(64), IN col VARCHAR(64))
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
	) THEN
		SET @s = CONCAT('ALTER TABLE `', tbl, '` DROP COLUMN `', col, '`');
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
	END IF;
END //

DROP PROCEDURE IF EXISTS diadem_add_idx //
CREATE PROCEDURE diadem_add_idx(
	IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols VARCHAR(255), IN is_unique BOOLEAN
)
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx
	) THEN
		SET @s = CONCAT(
			'ALTER TABLE `', tbl, '` ADD ', IF(is_unique, 'UNIQUE ', ''),
			'INDEX `', idx, '` ', cols
		);
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
	END IF;
END //

DROP PROCEDURE IF EXISTS diadem_add_fk //
CREATE PROCEDURE diadem_add_fk(
	IN tbl VARCHAR(64), IN fk_name VARCHAR(64),
	IN local_col VARCHAR(64), IN ref_tbl VARCHAR(64), IN ref_col VARCHAR(64)
)
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.key_column_usage
		WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = local_col
			AND referenced_table_name = ref_tbl AND referenced_column_name = ref_col
	) THEN
		SET @s = CONCAT(
			'ALTER TABLE `', tbl, '` ADD CONSTRAINT `', fk_name,
			'` FOREIGN KEY (`', local_col, '`) REFERENCES `', ref_tbl,
			'` (`', ref_col, '`) ON DELETE CASCADE'
		);
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
	END IF;
END //

-- Drops a non-cascade FK on (tbl → ref_tbl) and re-adds it with ON DELETE CASCADE.
-- No-op if the existing FK is already CASCADE, or if no FK exists.
DROP PROCEDURE IF EXISTS diadem_ensure_fk_cascade //
CREATE PROCEDURE diadem_ensure_fk_cascade(
	IN tbl VARCHAR(64), IN ref_tbl VARCHAR(64),
	IN new_fk_name VARCHAR(64), IN local_col VARCHAR(64), IN ref_col VARCHAR(64)
)
BEGIN
	DECLARE existing_fk VARCHAR(64) DEFAULT NULL;
	SELECT constraint_name INTO existing_fk
	FROM information_schema.referential_constraints
	WHERE constraint_schema = DATABASE() AND table_name = tbl
		AND referenced_table_name = ref_tbl AND delete_rule != 'CASCADE'
	LIMIT 1;

	IF existing_fk IS NOT NULL THEN
		SET @s = CONCAT('ALTER TABLE `', tbl, '` DROP FOREIGN KEY `', existing_fk, '`');
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
		SET @s = CONCAT(
			'ALTER TABLE `', tbl, '` ADD CONSTRAINT `', new_fk_name,
			'` FOREIGN KEY (`', local_col, '`) REFERENCES `', ref_tbl,
			'` (`', ref_col, '`) ON DELETE CASCADE'
		);
		PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
	END IF;
END //

DELIMITER ;

-- user: add Better Auth columns, backfill, tighten NOT NULL, relax JSON columns.
CALL diadem_add_col('user', 'name',           'VARCHAR(255) NULL');
CALL diadem_add_col('user', 'email',          'VARCHAR(255) NULL');
CALL diadem_add_col('user', 'email_verified', 'BOOLEAN NULL');
CALL diadem_add_col('user', 'image',          'TEXT NULL');
CALL diadem_add_col('user', 'created_at',     'DATETIME NULL');
CALL diadem_add_col('user', 'updated_at',     'DATETIME NULL');

UPDATE `user`
SET
	`name` = CASE
		WHEN `name` IS NULL OR `name` = '' THEN CONCAT('discord-', `discord_id`)
		ELSE `name`
	END,
	-- Synthetic email mirrors betterAuth.ts mapProfileToUser; the `.local`
	-- TLD ensures no system tries to deliver to it.
	`email` = CASE
		WHEN `email` IS NULL OR `email` = '' THEN CONCAT(`discord_id`, '@discord.diadem.local')
		ELSE `email`
	END,
	`email_verified` = COALESCE(`email_verified`, TRUE),
	`created_at` = COALESCE(`created_at`, NOW()),
	`updated_at` = COALESCE(`updated_at`, NOW());

ALTER TABLE `user`
	MODIFY COLUMN `name`           VARCHAR(255) NOT NULL,
	MODIFY COLUMN `email`          VARCHAR(255) NOT NULL,
	MODIFY COLUMN `email_verified` BOOLEAN NOT NULL,
	MODIFY COLUMN `created_at`     DATETIME NOT NULL,
	MODIFY COLUMN `updated_at`     DATETIME NOT NULL;

-- Better Auth's adapter inserts user rows without populating these, so
-- they must allow NULL; reads coerce via coercePerms (app code).
ALTER TABLE `user`
	MODIFY COLUMN `permissions`   JSON NULL,
	MODIFY COLUMN `user_settings` JSON NULL;

CALL diadem_add_idx('user', 'user_email_unique', '(`email`)', TRUE);

-- session: reshape the existing table to Better Auth's expected columns.
CALL diadem_add_col('session', 'token',      'VARCHAR(255) NULL');
CALL diadem_add_col('session', 'ip_address', 'TEXT NULL');
CALL diadem_add_col('session', 'user_agent', 'TEXT NULL');
CALL diadem_add_col('session', 'created_at', 'DATETIME NULL');
CALL diadem_add_col('session', 'updated_at', 'DATETIME NULL');

-- Old sessions are incompatible with Better Auth cookies/tokens. Guard on
-- the legacy discord_token column so re-running this script after the first
-- migration does not destroy live Better Auth sessions.
SET @stmt = (
	SELECT IF(
		EXISTS(
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = DATABASE() AND table_name = 'session' AND column_name = 'discord_token'
		),
		'DELETE FROM `session`',
		'SELECT 1'
	)
);
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CALL diadem_drop_col('session', 'discord_token');
CALL diadem_drop_col('session', 'discord_refresh_token');
CALL diadem_drop_col('session', 'discord_last_refresh');

UPDATE `session`
SET
	`token`      = COALESCE(`token`, `id`),
	`created_at` = COALESCE(`created_at`, NOW()),
	`updated_at` = COALESCE(`updated_at`, NOW());

ALTER TABLE `session`
	MODIFY COLUMN `token`      VARCHAR(255) NOT NULL,
	MODIFY COLUMN `created_at` DATETIME NOT NULL,
	MODIFY COLUMN `updated_at` DATETIME NOT NULL;

CALL diadem_add_idx('session', 'session_token_unique',   '(`token`)',      TRUE);
CALL diadem_add_idx('session', 'session_user_id_idx',    '(`user_id`)',    FALSE);
CALL diadem_add_idx('session', 'session_expires_at_idx', '(`expires_at`)', FALSE);

-- account, verification: new tables for Better Auth.
CREATE TABLE IF NOT EXISTS `account` (
	`id` VARCHAR(255) NOT NULL,
	`account_id` VARCHAR(255) NOT NULL,
	`provider_id` VARCHAR(255) NOT NULL,
	`user_id` VARCHAR(255) NOT NULL,
	`access_token` TEXT,
	`refresh_token` TEXT,
	`id_token` TEXT,
	`access_token_expires_at` DATETIME,
	`refresh_token_expires_at` DATETIME,
	`scope` TEXT,
	`password` TEXT,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	PRIMARY KEY (`id`),
	UNIQUE KEY `account_provider_account_unique` (`provider_id`, `account_id`),
	KEY `account_user_id_idx` (`user_id`),
	CONSTRAINT `account_user_id_user_id_fk`
		FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `verification` (
	`id` VARCHAR(255) NOT NULL,
	`identifier` VARCHAR(255) NOT NULL,
	`value` TEXT NOT NULL,
	`expires_at` DATETIME NOT NULL,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	PRIMARY KEY (`id`),
	KEY `verification_identifier_idx` (`identifier`),
	KEY `verification_expires_at_idx` (`expires_at`)
);

CALL diadem_add_idx('account', 'account_provider_account_unique', '(`provider_id`, `account_id`)', TRUE);
CALL diadem_add_idx('account', 'account_user_id_idx',             '(`user_id`)',                    FALSE);
CALL diadem_add_fk('account',  'account_user_id_user_id_fk', 'user_id', 'user', 'id');

CALL diadem_add_idx('verification', 'verification_identifier_idx', '(`identifier`)',  FALSE);
CALL diadem_add_idx('verification', 'verification_expires_at_idx', '(`expires_at`)',  FALSE);

-- Existing FKs on main lacked ON DELETE CASCADE; bring them in line.
CALL diadem_ensure_fk_cascade('session', 'user', 'session_user_id_user_id_fk', 'user_id', 'id');
CALL diadem_ensure_fk_cascade('account', 'user', 'account_user_id_user_id_fk', 'user_id', 'id');

DROP PROCEDURE diadem_add_col;
DROP PROCEDURE diadem_drop_col;
DROP PROCEDURE diadem_add_idx;
DROP PROCEDURE diadem_add_fk;
DROP PROCEDURE diadem_ensure_fk_cascade;
