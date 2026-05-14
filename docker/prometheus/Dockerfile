# Config is baked into the image so panel hosts that mishandle file/dir bind mounts
# still start Prometheus reliably.
FROM prom/prometheus:v2.55.1
COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY rules/ /etc/prometheus/rules/
