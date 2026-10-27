-- Snowflake objects Curialy AI relies on. Run as ACCOUNTADMIN in the account named by
-- SNOWFLAKE_ACCOUNT in /etc/curialyai.env. Everything here is idempotent. When the media vault
-- has its own account (SNOWFLAKE_MEDIA_ACCOUNT), run part 2 there, with app_role set to
-- SNOWFLAKE_MEDIA_ROLE.
--
-- Set these two to the values of SNOWFLAKE_ROLE and SNOWFLAKE_USER in /etc/curialyai.env.
-- (Since the 2026-10-26 account switch production uses CORTEX_API_ROLE / CORTEX_API_USER.)
SET app_role = 'CORTEX_API_ROLE';
SET app_user = 'CORTEX_API_USER';

-- ---------------------------------------------------------------------------
-- 1. Account, compute, role and user. Skip this part if they already exist (they do in
--    production: the role already has SNOWFLAKE.CORTEX_USER and USAGE on COMPUTE_WH).
-- ---------------------------------------------------------------------------

-- Cortex may serve models from other regions. Required for the models only offered through
-- SQL AI_COMPLETE (Gemini 4 Argon, Gemini 3.7 Flash, Llama 3.3 70B) and many REST models.
ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';

CREATE WAREHOUSE IF NOT EXISTS COMPUTE_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;

CREATE ROLE IF NOT EXISTS IDENTIFIER($app_role);
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE IDENTIFIER($app_role);
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE IDENTIFIER($app_role);
CREATE USER IF NOT EXISTS IDENTIFIER($app_user) DEFAULT_ROLE = $app_role DEFAULT_WAREHOUSE = COMPUTE_WH TYPE = SERVICE;
GRANT ROLE IDENTIFIER($app_role) TO USER IDENTIFIER($app_user);
-- Then create a programmatic access token for the user (Snowsight > user > Programmatic access
-- tokens). If it has a role restriction, it must be the role above. Put it in both env files.

-- ---------------------------------------------------------------------------
-- 2. User media storage (uploads, screenshots, agent artifacts). This is what a new account is
--    missing when every image request fails with "Stage ... does not exist or not authorized":
--    the app role cannot create a database itself.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS CURIALY_DB;
-- Server-side encryption is required for the presigned download URLs the app hands out.
CREATE STAGE IF NOT EXISTS CURIALY_DB.PUBLIC.USER_MEDIA_STAGE
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE') DIRECTORY = (ENABLE = TRUE);
GRANT USAGE ON DATABASE CURIALY_DB TO ROLE IDENTIFIER($app_role);
GRANT USAGE ON SCHEMA CURIALY_DB.PUBLIC TO ROLE IDENTIFIER($app_role);
GRANT READ, WRITE ON STAGE CURIALY_DB.PUBLIC.USER_MEDIA_STAGE TO ROLE IDENTIFIER($app_role);

-- ---------------------------------------------------------------------------
-- 3. Checks (as the app role). All three must succeed.
-- ---------------------------------------------------------------------------
--   USE ROLE IDENTIFIER($app_role); USE WAREHOUSE COMPUTE_WH;
--   SHOW GRANTS TO ROLE IDENTIFIER($app_role);
--   LIST @CURIALY_DB.PUBLIC.USER_MEDIA_STAGE;
--   SELECT AI_COMPLETE('gemini-4-argon', 'Reply with READY.');
--
-- The app notices within a few minutes (or immediately via Integrations > re-check), no restart
-- needed. Files stored before an account switch lived in the previous account's stage: they show
-- as "no longer available" (artifacts are still served from the task's archived workspace when
-- the archived copy matches).
