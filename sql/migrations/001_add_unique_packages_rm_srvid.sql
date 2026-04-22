-- تشغيل مرة واحدة إذا كان جدول packages موجوداً من إصدار سابق دون unique على rm_srvid
-- (منشآت جديدة تحصل على المفتاح من schema_extensions.sql مباشرة)

ALTER TABLE `packages`
  ADD UNIQUE KEY `uq_packages_tenant_rm_srvid` (`tenant_id`, `rm_srvid`);
