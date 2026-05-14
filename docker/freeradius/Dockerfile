# FreeRADIUS 3.x (Debian bookworm) + MySQL driver — pairs with Future Radius SaaS (same `radius` DB)
# Pin amd64 so Windows/Linux amd64 hosts never pull/run an arm64 base by mistake (avoids "exec format error").
FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       freeradius \
       freeradius-mysql \
       freeradius-utils \
       ca-certificates \
       netbase \
       gettext-base \
       procps \
       python3-minimal \
  && rm -rf /var/lib/apt/lists/*

COPY docker/freeradius/docker-entrypoint.sh /docker-entrypoint.sh
COPY docker/freeradius/mods-available/sql.template /etc/freeradius/3.0/mods-available/sql.template
COPY docker/freeradius/radiusd-performance.conf /etc/freeradius/3.0/radiusd-performance.conf
COPY docker/freeradius/sites-available/coa-futureradius /etc/freeradius/3.0/sites-available/coa-futureradius
COPY docker/freeradius/policy.d/futureradius-simultaneous-use /etc/freeradius/3.0/policy.d/futureradius-simultaneous-use
COPY docker/freeradius/inject-simultaneous-policy.py /tmp/inject-simultaneous-policy.py

RUN chmod +x /docker-entrypoint.sh \
  && : > /etc/freeradius/3.0/mods-available/sql \
  && ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql \
  && sed -i 's/secret, server \\/secret, NULL AS server \\/g' /etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf \
  && ln -sf /etc/freeradius/3.0/sites-available/coa-futureradius /etc/freeradius/3.0/sites-enabled/coa \
  && sed -i 's/^\([[:space:]]*\)-sql$/\1sql/' /etc/freeradius/3.0/sites-enabled/default \
  && sed -i '/^session {/,/^}$/s/^[[:space:]]*# sql$/\tsql/' /etc/freeradius/3.0/sites-enabled/default \
  && if [ -f /etc/freeradius/3.0/sites-enabled/inner-tunnel ]; then \
       sed -i 's/^\([[:space:]]*\)-sql$/\1sql/' /etc/freeradius/3.0/sites-enabled/inner-tunnel; \
     fi \
  && python3 /tmp/inject-simultaneous-policy.py /etc/freeradius/3.0/sites-enabled/default \
  && if [ -f /etc/freeradius/3.0/sites-enabled/inner-tunnel ]; then \
       python3 /tmp/inject-simultaneous-policy.py /etc/freeradius/3.0/sites-enabled/inner-tunnel; \
     fi \
  && rm -f /tmp/inject-simultaneous-policy.py \
  && printf '\n# Future Radius performance tuning\n$INCLUDE radiusd-performance.conf\n' >> /etc/freeradius/3.0/radiusd.conf

EXPOSE 1812/udp 1813/udp 3799/udp

# Explicit bash avoids rare shebang/exec issues; script must stay LF (see repo .gitattributes).
ENTRYPOINT ["/bin/bash", "/docker-entrypoint.sh"]
