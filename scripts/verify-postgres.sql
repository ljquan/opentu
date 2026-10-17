\set ON_ERROR_STOP on
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO opentu_app;
REVOKE INSERT, UPDATE, DELETE ON opentu_schema_migrations FROM opentu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE opentu_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opentu_app;
SET ROLE opentu_app;
SELECT version FROM opentu_schema_migrations;
SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS app_can_create_tables;
BEGIN;
INSERT INTO opentu_generation_rate_limits (user_id, operation, bucket_start, request_count) VALUES ('deployment-smoke', 'text', NOW(), 1);
SELECT request_count FROM opentu_generation_rate_limits WHERE user_id = 'deployment-smoke';
ROLLBACK;
RESET ROLE;
