

ALTER DATABASE bess OWNER TO bess_admin;


-- Reassign ownership of all existing relations (tables, views, sequences) in the public schema
REASSIGN OWNED BY current_user TO bess_admin;

GRANT ALL PRIVILEGES ON SCHEMA public TO bess_admin;
-- Grant execute permissions on all existing functions in the public schema
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO bess_admin;

-- Dynamically loop and alter ownership for all existing functions using pg_catalog
DO $$
DECLARE
    r RECORD;
    v_sql TEXT;
BEGIN
    FOR r IN 
        SELECT p.proname, n.nspname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
    LOOP
        v_sql := format('ALTER FUNCTION %I.%I(%s) OWNER TO bess_admin;', r.nspname, r.proname, r.args);
        EXECUTE v_sql;
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO bess_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO bess_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO bess_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TYPES TO bess_admin;