-- Future Radius: optional runtime wipe for container/bootstrap demo images (schema unchanged).
-- Keeps tenants/users/schema; clears FreeRADIUS accounting/auth mirror tables only.

DELETE FROM radacct;
DELETE FROM radpostauth;
DELETE FROM radcheck;
DELETE FROM radreply;
DELETE FROM radusergroup;
DELETE FROM nas;
