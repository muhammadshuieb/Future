# ملفات .sql لا تُوضع مباشرة في docker-entrypoint-initdb.d لأن الصورة الرسمية تشغّل:
#   docker_process_sql < "$f"
# وإذا كان المسار مجلداً (مشكلة Windows/OneDrive) → خطأ batch_readline.
# الحل: سكربت .sh يُدمَج (sourcing) ويقرأ SQL من /opt/futureradius/*.sql
FROM mysql:8

COPY docker/mysql/conf.d/ /etc/mysql/conf.d/

RUN mkdir -p /opt/futureradius

COPY docker/mysql/dma-radius-dump.sql /opt/futureradius/01-dma-dump.sql
COPY docker/mysql/opt/01b-freeradius-mysql-schema.sql /opt/futureradius/01b-freeradius-mysql-schema.sql
COPY sql/schema_extensions.sql /opt/futureradius/02-schema_extensions.sql
COPY docker/mysql/opt/03-freeradius-user.sql /opt/futureradius/03-freeradius-user.sql
COPY sql/migrations/004_radacct_cleanup_event.sql /opt/futureradius/04-radacct-cleanup-event.sql

COPY docker/mysql/init/00-futureradius-import.sh /docker-entrypoint-initdb.d/00-futureradius-import.sh

# تحقق أن المصدر ملف؛ تعطيل bit التنفيذ حتى يُفعَّل sourcing وليس تشغيل منفصل
RUN test -f /opt/futureradius/01-dma-dump.sql && ! test -d /opt/futureradius/01-dma-dump.sql \
 && test -f /opt/futureradius/01b-freeradius-mysql-schema.sql \
 && test -f /opt/futureradius/02-schema_extensions.sql \
 && test -f /opt/futureradius/03-freeradius-user.sql \
 && test -f /opt/futureradius/04-radacct-cleanup-event.sql \
 && chmod a-x /docker-entrypoint-initdb.d/00-futureradius-import.sh
