FROM mysql:8

COPY docker/mysql/conf.d/ /etc/mysql/conf.d/

RUN mkdir -p /opt/futureradius

COPY sql/migrations/001_initial_future_radius.sql /docker-entrypoint-initdb.d/01-futureradius-schema.sql
COPY docker/mysql/init/z-futureradius-followup.sh /docker-entrypoint-initdb.d/z-futureradius-followup.sh

RUN test -f /docker-entrypoint-initdb.d/01-futureradius-schema.sql \
 && chmod a-x /docker-entrypoint-initdb.d/z-futureradius-followup.sh
