# Future Radius — RADIUS / NAS integration test

Generated: 2026-05-13T20:25:54.165Z

Tenant: 00000000-0000-0000-0000-000000000001

Docker container: futureradius-freeradius-1

Docker CLI: ok

FreeRADIUS container running: yes

## 1) NAS (MikroTik-style lab)

- **TEST-NAS-01** id=`e7feb861-d176-40b0-98a7-4411b7c6c8ca` ip=`192.0.2.10` secret=`TEST-SECRET-NAS-01` (synced to FreeRADIUS `nas` table)

- **TEST-NAS-02** id=`a043764c-4d85-4f03-8132-d1c8db766941` ip=`192.0.2.11` secret=`TEST-SECRET-NAS-02` (synced to FreeRADIUS `nas` table)

- **TEST-NAS-03** id=`df9eb4b6-2a63-4e32-8064-da06e44f6261` ip=`192.0.2.12` secret=`TEST-SECRET-NAS-03` (synced to FreeRADIUS `nas` table)

- **TEST-NAS-04** id=`360df3eb-df11-44a3-b5ef-d60f5e89b5be` ip=`192.0.2.13` secret=`TEST-SECRET-NAS-04` (synced to FreeRADIUS `nas` table)

- **TEST-NAS-05** id=`d4b4f73a-98b7-4880-994e-81acad4b643b` ip=`192.0.2.14` secret=`TEST-SECRET-NAS-05` (synced to FreeRADIUS `nas` table)

## 2) Packages (profiles)

- **TEST-50MB** id=`3c005560-4c77-4668-8077-16563be3012e` rate `1M/1M` quota **52428800** bytes (50 MiB)

- **TEST-1M** id=`1473ac96-a38e-4ac2-b7ad-da19d2168823` rate `1M/1M` quota **0** (volume unlimited; expiry drives denial)

- **TEST-PREPAID-PKG** id=`a03fc66c-7c9e-4043-9074-c23afb3bb4d9` rate `1M/1M` quota **10485760** bytes (10 MiB lab card value)

## 3) Subscribers

- **TEST-Q50-U01** id=`d54f6bf5-dbaf-4c52-aee1-7d0ad30673cc` package TEST-50MB

- **TEST-Q50-U02** id=`bd1f47b1-a966-44ba-84d1-7bf147a9975c` package TEST-50MB

- **TEST-Q50-U03** id=`19caf77b-896a-4a99-9e6a-49403931d72c` package TEST-50MB

- **TEST-EXPIRED** id=`e8b5ec97-0357-4884-aaa6-1e8a92ea5f62` package TEST-1M, expiration in the past

- **TEST-1M-SUB** id=`8c7bd8e8-bb00-494c-95b1-0136a5485d9a` package TEST-1M

- **TEST-PREPAID-TARGET** id=`29ead1f7-88df-4d01-9677-08f531046e3e` (starts without package; cards attach package)

## 4) Prepaid integration cards (migration 006)

- Cards **TEST-RECHARGE-01**, **TEST-RECHARGE-02** ensured (`available` until redeemed).

## 5) RADIUS authentication

- **TEST-Q50-U01** via **TEST-NAS-01** (192.0.2.10): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 221 from 0.0.0.0:46778 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 221 from 0.0.0.0:46778 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 221 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U01** via **TEST-NAS-02** (192.0.2.11): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 62 from 0.0.0.0:59974 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 62 from 0.0.0.0:59974 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 62 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U01** via **TEST-NAS-03** (192.0.2.12): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 243 from 0.0.0.0:39442 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 243 from 0.0.0.0:39442 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 243 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U01** via **TEST-NAS-04** (192.0.2.13): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 35 from 0.0.0.0:60371 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 35 from 0.0.0.0:60371 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 35 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U01** via **TEST-NAS-05** (192.0.2.14): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 71 from 0.0.0.0:43886 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 71 from 0.0.0.0:43886 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 71 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U02** via **TEST-NAS-01** (192.0.2.10): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 243 from 0.0.0.0:56557 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 243 from 0.0.0.0:56557 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 243 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U02** via **TEST-NAS-02** (192.0.2.11): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 122 from 0.0.0.0:52611 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 122 from 0.0.0.0:52611 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 122 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U02** via **TEST-NAS-03** (192.0.2.12): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 194 from 0.0.0.0:35319 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 194 from 0.0.0.0:35319 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 194 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U02** via **TEST-NAS-04** (192.0.2.13): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 106 from 0.0.0.0:43064 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 106 from 0.0.0.0:43064 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 106 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U02** via **TEST-NAS-05** (192.0.2.14): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 99 from 0.0.0.0:56184 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 99 from 0.0.0.0:56184 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 99 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U03** via **TEST-NAS-01** (192.0.2.10): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 133 from 0.0.0.0:37236 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 133 from 0.0.0.0:37236 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 133 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U03** via **TEST-NAS-02** (192.0.2.11): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 6 from 0.0.0.0:35917 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 6 from 0.0.0.0:35917 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 6 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U03** via **TEST-NAS-03** (192.0.2.12): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 204 from 0.0.0.0:60970 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 204 from 0.0.0.0:60970 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 204 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U03** via **TEST-NAS-04** (192.0.2.13): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 159 from 0.0.0.0:58589 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 159 from 0.0.0.0:58589 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 159 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

- **TEST-Q50-U03** via **TEST-NAS-05** (192.0.2.14): radclient exit=1 Reject (docker)

```
Sent Access-Request Id 194 from 0.0.0.0:44818 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Sent Access-Request Id 194 from 0.0.0.0:44818 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
(0) No reply from server for ID 194 socket 3

(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
(0) Reply verification failed: Received Access-Reject packet from home server 127.0.0.1 port 1812 with invalid Response Authenticator!  (Shared secret is incorrect.)
```

### 5b) TEST-EXPIRED — expect Access-Reject

- TEST-EXPIRED via TEST-NAS-01: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 20:29:18 GMT+0300 (التوقيت العربي الرسمي)

- TEST-EXPIRED via TEST-NAS-02: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 20:29:34 GMT+0300 (التوقيت العربي الرسمي)

- TEST-EXPIRED via TEST-NAS-03: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 20:29:47 GMT+0300 (التوقيت العربي الرسمي)

- TEST-EXPIRED via TEST-NAS-04: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 20:30:00 GMT+0300 (التوقيت العربي الرسمي)

- TEST-EXPIRED via TEST-NAS-05: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 20:30:14 GMT+0300 (التوقيت العربي الرسمي)

### 5c) TEST-1M-SUB — rate limit in Access-Accept

- radclient exit=1 Reject (docker)

  - **Note**: expected Mikrotik-Rate-Limit containing `1M`, got: ``

## 6) Accounting — drive TEST-Q50-U01 to 50 MiB quota

### 6a) radclient accounting transcript (subset)

```
exit=1
Sent Accounting-Request Id 120 from 0.0.0.0:45847 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Start
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 0
	Acct-Output-Octets = 0
Sent Accounting-Request Id 120 from 0.0.0.0:45847 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Start
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 0
	Acct-Output-Octets = 0
(0) No reply from server for ID 120 socket 3
---
exit=1
Sent Accounting-Request Id 127 from 0.0.0.0:47654 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 2000000
	Acct-Output-Octets = 0
Sent Accounting-Request Id 127 from 0.0.0.0:47654 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 2000000
	Acct-Output-Octets = 0
(0) No reply from server for ID 127 socket 3
---
exit=1
Sent Accounting-Request Id 27 from 0.0.0.0:47704 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 8000000
	Acct-Output-Octets = 0
Sent Accounting-Request Id 27 from 0.0.0.0:47704 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 8000000
	Acct-Output-Octets = 0
(0) No reply from server for ID 27 socket 3
---
exit=1
Sent Accounting-Request Id 168 from 0.0.0.0:57498 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 20000000
	Acct-Output-Octets = 0
Sent Accounting-Request Id 168 from 0.0.0.0:57498 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 20000000
	Acct-Output-Octets = 0
(0) No reply from server for ID 168 socket 3
---
exit=1
Sent Accounting-Request Id 234 from 0.0.0.0:53684 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 40000000
	Acct-Output-Octets = 0
Sent Accounting-Request Id 234 from 0.0.0.0:53684 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 40000000
	Acct-Output-Octets = 0
(0) No reply from server for ID 234 socket 3
---
exit=1
Sent Accounting-Request Id 47 from 0.0.0.0:33441 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 52000000
	Acct-Output-Octets = 0
Sent Accounting-Request Id 47 from 0.0.0.0:33441 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 52000000
	Acct-Output-Octets = 0
(0) No reply from server for ID 47 socket 3
---
exit=1
Sent Accounting-Request Id 224 from 0.0.0.0:50899 to 127.0.0.1:1813 length 108
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Stop
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 54428800
	Acct-Output-Octets = 0
	Acct-Session-Time = 120
	Acct-Terminate-Cause = User-Request
Sent Accounting-Request Id 224 from 0.0.0.0:50899 to 127.0.0.1:1813 length 108
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-3c119353"
	Acct-Status-Type = Stop
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 54428800
	Acct-Output-Octets = 0
	Acct-Session-Time = 120
	Acct-Terminate-Cause = User-Request
(0) No reply from server for ID 224 socket 3
```

- After policy cycle: status=**active** used_bytes=**0** (quota 52428800)

- Re-auth after quota: radclient exit=1 Reject (docker)

## 7) CoA / Disconnect expectations

- disconnectAllSessions after quota: anyOk=**false** (UDP to lab NAS IPs usually fails without a live router)

```
[]
```

**Note**: With documentation IPs (192.0.2.0/24) the stack still *attempts* Disconnect-Request; lack of ACK is expected in this lab. Production MikroTik must expose RADIUS incoming on 3799 for positive ACKs.

## 8) TEST-1M-SUB — expiry then reject

- Auth after moving expiration to past: radclient exit=1 Reject (docker)

- Subscriber status after worker: **expired**

## 9) Prepaid card redeem + consume + reuse block

- Redeem TEST-RECHARGE-01: {"ok":true}

- Second redeem same code (expect fail): {"ok":false,"reason":"card_consumed"}

- After consuming prepaid quota: subscriber status=**active** used_bytes=**0**

- Card TEST-RECHARGE-01 status=**consumed** (should remain **consumed**, not reusable)

- Re-auth prepaid target: radclient exit=1 Reject (docker)

## 10) Summary

- **nas_seed**: PASSED

- **packages**: PASSED

- **subscribers_seed**: PASSED

- **prepaid_cards**: PASSED

- **auth_matrix_50mb_users**: FAILED

- **auth_expired**: PASSED

- **auth_rate_1m**: FAILED

- **quota_50mb_suspend**: FAILED

- **coa_lab_note**: PASSED

- **subscription_expiry_1m**: PASSED

- **prepaid_redeem_consume**: FAILED

OVERALL: **FAILED** (see FAILED lines)
