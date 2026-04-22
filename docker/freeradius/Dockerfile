# FreeRADIUS 3.x (Debian bookworm) + MySQL driver — pairs with Future Radius SaaS (same `radius` DB)
FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       freeradius \
       freeradius-mysql \
       freeradius-utils \
       ca-certificates \
       gettext-base \
  && rm -rf /var/lib/apt/lists/*

COPY docker/freeradius/docker-entrypoint.sh /docker-entrypoint.sh
COPY docker/freeradius/mods-available/sql.template /etc/freeradius/3.0/mods-available/sql.template
COPY docker/freeradius/radiusd-performance.conf /etc/freeradius/3.0/radiusd-performance.conf
COPY docker/freeradius/sites-available/coa-futureradius /etc/freeradius/3.0/sites-available/coa-futureradius

RUN chmod +x /docker-entrypoint.sh \
  && : > /etc/freeradius/3.0/mods-available/sql \
  && ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql \
  && ln -sf /etc/freeradius/3.0/sites-available/coa-futureradius /etc/freeradius/3.0/sites-enabled/coa \
  && sed -i 's/^\([[:space:]]*\)-sql$/\1sql/' /etc/freeradius/3.0/sites-enabled/default \
  && sed -i '/^session {/,/^}$/s/^[[:space:]]*# sql$/\tsql/' /etc/freeradius/3.0/sites-enabled/default \
  && if [ -f /etc/freeradius/3.0/sites-enabled/inner-tunnel ]; then \
       sed -i 's/^\([[:space:]]*\)-sql$/\1sql/' /etc/freeradius/3.0/sites-enabled/inner-tunnel; \
     fi \
  && printf '\n# Future Radius performance tuning\n$INCLUDE radiusd-performance.conf\n' >> /etc/freeradius/3.0/radiusd.conf

EXPOSE 1812/udp 1813/udp 3799/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
