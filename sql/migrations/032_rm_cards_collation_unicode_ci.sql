-- rm_cards was created without COLLATE (MySQL 8 defaults to utf8mb4_0900_ai_ci).
-- radacct and the API pool use utf8mb4_unicode_ci — joins on cardnum = username fail without this.

ALTER TABLE rm_cards CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
