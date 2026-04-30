-- Future Radius clean install state (no runtime data)
-- Keeps only minimal internal defaults needed for creating the first package later.

-- NAS inventory should start empty.
DELETE FROM nas;

-- Keep only template service (srvid = 0) for rm_services clone-on-create flow.
DELETE FROM rm_allowednases;
DELETE FROM rm_allowedmanagers;
DELETE FROM rm_services WHERE srvid <> 0;

-- Remove Radius Manager users/managers from baseline dump.
DELETE FROM rm_users;
DELETE FROM rm_managers;

-- Also ensure FreeRADIUS auth/accounting tables are empty.
DELETE FROM radcheck;
DELETE FROM radreply;
DELETE FROM radusergroup;
DELETE FROM radacct;
DELETE FROM radpostauth;
