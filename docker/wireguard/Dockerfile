FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 iptables procps ca-certificates iputils-ping \
  && rm -rf /var/lib/apt/lists/*

COPY docker/wireguard/entrypoint.sh /usr/local/bin/wireguard-entrypoint.sh
RUN chmod +x /usr/local/bin/wireguard-entrypoint.sh

ENV WIREGUARD_RUNTIME_DIR=/var/lib/futureradius/wireguard

ENTRYPOINT ["/usr/local/bin/wireguard-entrypoint.sh"]
