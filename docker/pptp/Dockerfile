FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends pptpd ppp iproute2 procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY docker/pptp/entrypoint.sh /usr/local/bin/pptp-entrypoint.sh
RUN chmod +x /usr/local/bin/pptp-entrypoint.sh

EXPOSE 1723/tcp

ENTRYPOINT ["/usr/local/bin/pptp-entrypoint.sh"]
