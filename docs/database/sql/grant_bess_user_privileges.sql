-- Runtime user privileges
GRANT CONNECT ON DATABASE bess TO bess_user;
GRANT USAGE ON SCHEMA public TO bess_user;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO bess_user;
GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA public
    TO bess_user;
GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA public
    TO bess_user;

-- Permissions for future objects created by bess_admin
ALTER DEFAULT PRIVILEGES
    FOR ROLE bess_admin
    IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLES TO bess_user;

ALTER DEFAULT PRIVILEGES
    FOR ROLE bess_admin
    IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE
    ON SEQUENCES TO bess_user;

ALTER DEFAULT PRIVILEGES
    FOR ROLE bess_admin
    IN SCHEMA public
    GRANT EXECUTE
    ON FUNCTIONS TO bess_user;

ALTER DEFAULT PRIVILEGES
    FOR ROLE bess_admin
    IN SCHEMA public
    GRANT USAGE
    ON TYPES TO bess_user;
