-- Remove integration-test artifacts (TEST-* lab entities, prepaid_integration_test_cards).
-- Safe to re-run: conditional deletes and DROP IF EXISTS only.

DROP TABLE IF EXISTS prepaid_integration_test_cards;

DELETE FROM radcheck WHERE username LIKE 'TEST-%';
DELETE FROM radreply WHERE username LIKE 'TEST-%';
DELETE FROM radpostauth WHERE username LIKE 'TEST-%';
DELETE FROM radacct WHERE username LIKE 'TEST-%';

DELETE FROM session_interim_updates WHERE session_id IN (SELECT id FROM sessions WHERE username LIKE 'TEST-%');
DELETE FROM sessions WHERE username LIKE 'TEST-%';

DELETE FROM subscriber_credentials
WHERE subscriber_id IN (SELECT id FROM subscribers WHERE username LIKE 'TEST-%');
DELETE FROM subscribers WHERE username LIKE 'TEST-%';

DELETE FROM packages WHERE name LIKE 'TEST-%';

DELETE FROM nas_devices WHERE name LIKE 'TEST-NAS-%' OR ip LIKE '192.0.2.%';

DELETE FROM nas WHERE nasname LIKE '192.0.2.%';
