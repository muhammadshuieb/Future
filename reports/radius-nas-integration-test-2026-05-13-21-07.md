# Future Radius — RADIUS / NAS integration test

Generated: 2026-05-13T21:07:33.495Z

Tenant: 00000000-0000-0000-0000-000000000001

Docker container: futureradius-freeradius-1

Docker CLI: ok

FreeRADIUS container running: yes

## 1) NAS (MikroTik-style lab)

- **radclient** يستخدم سر العميل الافتراضي لـ `127.0.0.1` من `clients.conf` (افتراضيًا `testing123`؛ يُستبدل بـ `RADIUS_TEST_LOCAL_CLIENT_SECRET` إن رغبت).

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

- **TEST-Q50-U01** via **TEST-NAS-01** (192.0.2.10): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 169 from 0.0.0.0:47109 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 169 from 127.0.0.1:1812 to 127.0.0.1:47109 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U01** via **TEST-NAS-02** (192.0.2.11): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 21 from 0.0.0.0:58603 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 21 from 127.0.0.1:1812 to 127.0.0.1:58603 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U01** via **TEST-NAS-03** (192.0.2.12): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 3 from 0.0.0.0:59496 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 3 from 127.0.0.1:1812 to 127.0.0.1:59496 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U01** via **TEST-NAS-04** (192.0.2.13): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 224 from 0.0.0.0:59776 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 224 from 127.0.0.1:1812 to 127.0.0.1:59776 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U01** via **TEST-NAS-05** (192.0.2.14): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 114 from 0.0.0.0:54259 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U01"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 114 from 127.0.0.1:1812 to 127.0.0.1:54259 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U02** via **TEST-NAS-01** (192.0.2.10): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 55 from 0.0.0.0:60101 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 55 from 127.0.0.1:1812 to 127.0.0.1:60101 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U02** via **TEST-NAS-02** (192.0.2.11): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 229 from 0.0.0.0:57260 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 229 from 127.0.0.1:1812 to 127.0.0.1:57260 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U02** via **TEST-NAS-03** (192.0.2.12): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 65 from 0.0.0.0:60869 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 65 from 127.0.0.1:1812 to 127.0.0.1:60869 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U02** via **TEST-NAS-04** (192.0.2.13): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 58 from 0.0.0.0:36010 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 58 from 127.0.0.1:1812 to 127.0.0.1:36010 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U02** via **TEST-NAS-05** (192.0.2.14): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 245 from 0.0.0.0:46075 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U02"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 245 from 127.0.0.1:1812 to 127.0.0.1:46075 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U03** via **TEST-NAS-01** (192.0.2.10): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 20 from 0.0.0.0:36944 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.10
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 20 from 127.0.0.1:1812 to 127.0.0.1:36944 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U03** via **TEST-NAS-02** (192.0.2.11): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 87 from 0.0.0.0:55123 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.11
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 87 from 127.0.0.1:1812 to 127.0.0.1:55123 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U03** via **TEST-NAS-03** (192.0.2.12): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 210 from 0.0.0.0:47327 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.12
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 210 from 127.0.0.1:1812 to 127.0.0.1:47327 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U03** via **TEST-NAS-04** (192.0.2.13): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 45 from 0.0.0.0:57927 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.13
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 45 from 127.0.0.1:1812 to 127.0.0.1:57927 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

- **TEST-Q50-U03** via **TEST-NAS-05** (192.0.2.14): radclient exit=0 Accept (docker)

```
Sent Access-Request Id 88 from 0.0.0.0:41657 to 127.0.0.1:1812 length 58
	User-Name = "TEST-Q50-U03"
	User-Password = "TEST-PASS-50MB!"
	NAS-IP-Address = 192.0.2.14
	Cleartext-Password = "TEST-PASS-50MB!"
Received Access-Accept Id 88 from 127.0.0.1:1812 to 127.0.0.1:41657 length 33
	Mikrotik-Rate-Limit = "1M/1M"
```

### 5b) TEST-EXPIRED — expect Access-Reject

- TEST-EXPIRED via TEST-NAS-01: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 21:07:37 GMT+0000 (Coordinated Universal Time)

- TEST-EXPIRED via TEST-NAS-02: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 21:07:39 GMT+0000 (Coordinated Universal Time)

- TEST-EXPIRED via TEST-NAS-03: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 21:07:40 GMT+0000 (Coordinated Universal Time)

- TEST-EXPIRED via TEST-NAS-04: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 21:07:41 GMT+0000 (Coordinated Universal Time)

- TEST-EXPIRED via TEST-NAS-05: radclient exit=1 Reject (docker)

  - radpostauth.reply: **Access-Reject** @ Wed May 13 2026 21:07:42 GMT+0000 (Coordinated Universal Time)

### 5c) TEST-1M-SUB — rate limit in Access-Accept

- radclient exit=0 Accept (docker)

## 6) Accounting — drive TEST-Q50-U01 to 50 MiB quota

### 6a) radclient accounting transcript (subset)

```
exit=0
Sent Accounting-Request Id 179 from 0.0.0.0:36100 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Start
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 0
	Acct-Output-Octets = 0
Received Accounting-Response Id 179 from 127.0.0.1:1813 to 127.0.0.1:36100 length 20
---
exit=0
Sent Accounting-Request Id 212 from 0.0.0.0:58404 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 2000000
	Acct-Output-Octets = 0
Received Accounting-Response Id 212 from 127.0.0.1:1813 to 127.0.0.1:58404 length 20
---
exit=0
Sent Accounting-Request Id 241 from 0.0.0.0:47719 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 8000000
	Acct-Output-Octets = 0
Received Accounting-Response Id 241 from 127.0.0.1:1813 to 127.0.0.1:47719 length 20
---
exit=0
Sent Accounting-Request Id 93 from 0.0.0.0:57630 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 20000000
	Acct-Output-Octets = 0
Received Accounting-Response Id 93 from 127.0.0.1:1813 to 127.0.0.1:57630 length 20
---
exit=0
Sent Accounting-Request Id 136 from 0.0.0.0:52507 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 40000000
	Acct-Output-Octets = 0
Received Accounting-Response Id 136 from 127.0.0.1:1813 to 127.0.0.1:52507 length 20
---
exit=0
Sent Accounting-Request Id 6 from 0.0.0.0:35939 to 127.0.0.1:1813 length 96
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Interim-Update
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 52000000
	Acct-Output-Octets = 0
Received Accounting-Response Id 6 from 127.0.0.1:1813 to 127.0.0.1:35939 length 20
---
exit=0
Sent Accounting-Request Id 132 from 0.0.0.0:44232 to 127.0.0.1:1813 length 108
	User-Name = "TEST-Q50-U01"
	NAS-IP-Address = 192.0.2.10
	Acct-Session-Id = "TEST-SESS-2bfa5feb"
	Acct-Status-Type = Stop
	Acct-Authentic = RADIUS
	Service-Type = Framed-User
	Framed-Protocol = PPP
	Acct-Input-Octets = 54428800
	Acct-Output-Octets = 0
	Acct-Session-Time = 120
	Acct-Terminate-Cause = User-Request
Received Accounting-Response Id 132 from 127.0.0.1:1813 to 127.0.0.1:44232 length 20
```

- After policy cycle: status=**suspended** used_bytes=**54428800** (quota 52428800)

- Re-auth after quota: radclient exit=1 Reject (docker)

- Latest radacct: nas=`192.0.2.10` start=`Wed May 13 2026 21:07:43 GMT+0000 (Coordinated Universal Time)` stop=`Wed May 13 2026 21:07:44 GMT+0000 (Coordinated Universal Time)` in/out=`54428800`/`0` term=`User-Request`

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

- After consuming prepaid quota: subscriber status=**suspended** used_bytes=**10985760**

- Card TEST-RECHARGE-01 status=**consumed** (should remain **consumed**, not reusable)

- Re-auth prepaid target: radclient exit=1 Reject (docker)

## 10) Summary

- **nas_seed**: PASSED

- **packages**: PASSED

- **subscribers_seed**: PASSED

- **prepaid_cards**: PASSED

- **auth_matrix_50mb_users**: PASSED

- **auth_expired**: PASSED

- **auth_rate_1m**: PASSED

- **quota_50mb_suspend**: PASSED

- **coa_lab_note**: PASSED

- **subscription_expiry_1m**: PASSED

- **prepaid_redeem_consume**: PASSED

OVERALL: **PASSED** (within lab limits)
