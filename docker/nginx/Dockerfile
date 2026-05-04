# API reverse proxy — config baked in so deploy never depends on a host bind-mount
# (missing file → Docker creates a directory → "not a directory" mount error).
FROM nginx:1.27-alpine
COPY docker/nginx/api-proxy.conf /etc/nginx/conf.d/default.conf
