#!/bin/bash
# يُشغَّل عبر sourcing من docker-entrypoint.sh الرسمي (لا تُنفَّذ مباشرة؛ اجعله غير قابل للتنفيذ: chmod -x)
# يستورد من مسارات داخل الصورة حيث يكون الـ SQL ملفاً حقيقياً — يتفادى docker_process_sql < مجلد
mysql_note "futureradius: importing DMA dump"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/01-dma-dump.sql
mysql_note "futureradius: FreeRADIUS core tables (nas, radacct, …) if dump did not create them"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/01b-freeradius-mysql-schema.sql
mysql_note "futureradius: importing schema_extensions"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/02-schema_extensions.sql
mysql_note "futureradius: freeradius SQL user"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/03-freeradius-user.sql
mysql_note "futureradius: radacct daily cleanup event (30d retention)"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/04-radacct-cleanup-event.sql
