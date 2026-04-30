-- بعد استيراد dump كبير لـ radacct: تعطيل إعادة حساب إحصائيات InnoDB التلقائية على مستوى الجدول.
-- في MySQL 8.4+ قد يظهر MY-015116 «Background histogram update … Lock wait timeout» عندما
-- يتعارض خيط الإحصائيات مع محاسبة RADIUS على radacct؛ إسقاط أي histograms موجودة يقلّل
-- العمل الخلفي. التحذير قد يبقى نادراً (~مرة/دقيقة) وهو غالباً غير ضار (سلوك upstream).
-- راجع أيضاً radius-import.cnf (innodb_stats_auto_recalc=OFF).
ALTER TABLE radacct STATS_AUTO_RECALC = 0;

SET SESSION group_concat_max_len = 1048576;

SELECT GROUP_CONCAT(
         CONCAT('`', REPLACE(COLUMN_NAME, '`', '``'), '`')
         ORDER BY COLUMN_NAME
         SEPARATOR ', '
       )
  INTO @fr_radacct_hist_cols
  FROM information_schema.column_statistics
  WHERE SCHEMA_NAME = DATABASE()
    AND TABLE_NAME = 'radacct';

SET @fr_stmt := IF(
  @fr_radacct_hist_cols IS NULL OR @fr_radacct_hist_cols = '',
  'SELECT 1 AS futureradius_skip_radacct_histogram_drop',
  CONCAT('ANALYZE TABLE radacct DROP HISTOGRAM ON ', @fr_radacct_hist_cols)
);

PREPARE fr_hdrop FROM @fr_stmt;
EXECUTE fr_hdrop;
DEALLOCATE PREPARE fr_hdrop;
