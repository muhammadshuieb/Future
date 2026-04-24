FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    pptpd \
    ppp \
    iproute2 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY docker/pptp/options.pptpd /etc/ppp/options.pptpd
COPY docker/pptp/entrypoint.sh /usr/local/bin/pptp-entrypoint.sh

RUN chmod +x /usr/local/bin/pptp-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/pptp-entrypoint.sh"]
