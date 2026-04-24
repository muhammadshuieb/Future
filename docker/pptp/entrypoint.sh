#!/usr/bin/env sh
set -eu

PPTP_SERVER_LOCAL_IP="${PPTP_SERVER_LOCAL_IP:-10.10.10.1}"
PPTP_CLIENT_IP_RANGE="${PPTP_CLIENT_IP_RANGE:-10.10.10.100-10.10.10.240}"
PPTP_DNS1="${PPTP_DNS1:-1.1.1.1}"
PPTP_DNS2="${PPTP_DNS2:-8.8.8.8}"
PPTP_MTU="${PPTP_MTU:-1400}"
PPTP_MRU="${PPTP_MRU:-1400}"
PPTP_USERS="${PPTP_USERS:-}"

if [ -z "$PPTP_USERS" ]; then
  echo "PPTP_USERS is empty. Example: PPTP_USERS=nas1:pass1,nas2:pass2"
  exit 1
fi

cat >/etc/pptpd.conf <<EOF
option /etc/ppp/options.pptpd
logwtmp
localip $PPTP_SERVER_LOCAL_IP
remoteip $PPTP_CLIENT_IP_RANGE
EOF

cat >/etc/ppp/options.pptpd <<EOF
name FutureRadiusPPTP
refuse-pap
refuse-chap
refuse-mschap
require-mschap-v2
require-mppe-128
ms-dns $PPTP_DNS1
ms-dns $PPTP_DNS2
proxyarp
lock
nobsdcomp
novj
novjccomp
nologfd
mtu $PPTP_MTU
mru $PPTP_MRU
EOF

cat >/etc/ppp/chap-secrets <<EOF
# client    server    secret    IP addresses
EOF

OLD_IFS=$IFS
IFS=','
for entry in $PPTP_USERS; do
  user=$(echo "$entry" | cut -d: -f1)
  pass=$(echo "$entry" | cut -d: -f2-)
  if [ -z "$user" ] || [ -z "$pass" ] || [ "$user" = "$entry" ]; then
    echo "Invalid PPTP_USERS entry: $entry"
    exit 1
  fi
  printf '"%s" pptpd "%s" *\n' "$user" "$pass" >>/etc/ppp/chap-secrets
done
IFS=$OLD_IFS

chmod 600 /etc/ppp/chap-secrets

echo "Starting PPTP VPN server with local IP ${PPTP_SERVER_LOCAL_IP}"
exec /usr/sbin/pptpd --fg
