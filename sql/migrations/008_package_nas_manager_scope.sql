-- Package scope: allowed NAS devices (nas_devices.id) and which manager users may use the package.
-- NULL JSON columns = no restriction (legacy behaviour). Non-empty JSON array = whitelist.
-- Re-runnable: duplicate column errors are treated as benign by applyAllMigrations.

ALTER TABLE packages ADD COLUMN allowed_nas_ids JSON NULL DEFAULT NULL COMMENT 'JSON array of nas_devices.id; NULL = any NAS';
ALTER TABLE packages ADD COLUMN available_manager_user_ids JSON NULL DEFAULT NULL COMMENT 'JSON array of users.id (manager role); NULL = any manager';
