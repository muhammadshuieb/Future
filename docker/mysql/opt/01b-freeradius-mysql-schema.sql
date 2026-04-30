-- Future Radius — لا يُنشئ هنا مخطط FreeRADIUS «الرسمي» البديل.
-- جداول DMA + RADIUS القديمة (nas, radacct, radusergroup, …) تأتي حصرياً من
-- sql/radius-dma-baseline.sql (نفس بنية تصدير phpMyAdmin / Radius Manager).
-- المخطط البديل السابق كان يختلف عن ملفات الاستعادة (أعمدة radacct، nas، radusergroup)
-- ويسبب تعارضاً عند الدمج مع dump حقيقي.
SET NAMES utf8mb4;
SELECT 1 AS futureradius_skip_alternate_freeradius_schema;
