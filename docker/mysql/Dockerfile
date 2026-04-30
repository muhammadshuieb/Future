# SQL under docker-entrypoint-initdb.d runs in lexical order:
#   01-radius.sql → 02-cumulate.sql → 03-conntrack.sql → z-futureradius-followup.sh
# Baseline matches Radius Manager radius.sql (see sql/radius-dma-baseline.sql).
FROM mysql:8

COPY docker/mysql/conf.d/ /etc/mysql/conf.d/

RUN mkdir -p /opt/futureradius

COPY sql/radius-dma-baseline.sql /docker-entrypoint-initdb.d/01-radius.sql
COPY sql/dma-init/02-cumulate.sql /docker-entrypoint-initdb.d/02-cumulate.sql
COPY sql/dma-init/03-conntrack.sql /docker-entrypoint-initdb.d/03-conntrack.sql
COPY sql/radius-dma-baseline.sql /opt/futureradius/radius-dma-baseline.sql
COPY docker/mysql/opt/01b-freeradius-mysql-schema.sql /opt/futureradius/01b-freeradius-mysql-schema.sql
COPY docker/mysql/opt/04-radacct-cleanup-event.sql /opt/futureradius/04-radacct-cleanup-event.sql
COPY docker/mysql/opt/05-radacct-stats-autorecalc-off.sql /opt/futureradius/05-radacct-stats-autorecalc-off.sql
COPY docker/mysql/opt/06-clean-install-state.sql /opt/futureradius/06-clean-install-state.sql

COPY docker/mysql/init/z-futureradius-followup.sh /docker-entrypoint-initdb.d/z-futureradius-followup.sh

RUN test -f /docker-entrypoint-initdb.d/01-radius.sql && ! test -d /docker-entrypoint-initdb.d/01-radius.sql \
 && test -f /docker-entrypoint-initdb.d/02-cumulate.sql \
 && test -f /docker-entrypoint-initdb.d/03-conntrack.sql \
 && test -f /opt/futureradius/radius-dma-baseline.sql \
 && test -f /opt/futureradius/01b-freeradius-mysql-schema.sql \
 && test -f /opt/futureradius/04-radacct-cleanup-event.sql \
 && test -f /opt/futureradius/05-radacct-stats-autorecalc-off.sql \
 && test -f /opt/futureradius/06-clean-install-state.sql \
 && chmod a-x /docker-entrypoint-initdb.d/z-futureradius-followup.sh
