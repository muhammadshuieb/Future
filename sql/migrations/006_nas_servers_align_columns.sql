-- يُنفَّذ مرة واحدة على قاعدة `radius` إن كان جدول nas_servers قديماً بلا أعمدة المراقبة.
-- إن ظهر خطأ "Duplicate column" تجاهل السطر وتابع.
-- يطابق sql/schema_extensions.sql

USE radius;

ALTER TABLE nas_servers
  ADD COLUMN coa_port INT NOT NULL DEFAULT 3799;
ALTER TABLE nas_servers
  ADD COLUMN online_status ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown';
ALTER TABLE nas_servers
  ADD COLUMN last_ping_ok TINYINT(1) DEFAULT NULL;
ALTER TABLE nas_servers
  ADD COLUMN last_radius_ok TINYINT(1) DEFAULT NULL;
ALTER TABLE nas_servers
  ADD COLUMN last_check_at DATETIME(3) DEFAULT NULL;
ALTER TABLE nas_servers
  ADD COLUMN session_count INT UNSIGNED NOT NULL DEFAULT 0;
