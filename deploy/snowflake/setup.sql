-- Snowflake objects Curialy AI relies on. Run as ACCOUNTADMIN (adjust names to match
-- /etc/curialyai.env). Everything here is idempotent.

-- Cortex may serve models from other regions. Required for the models only offered through
-- SQL AI_COMPLETE (Gemini 4 Argon, Gemini 3.7 Flash, Llama 3.3 70B) and many REST models.
ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';

-- Compute for AI_COMPLETE and stage operations.
CREATE WAREHOUSE IF NOT EXISTS COMPUTE_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;

-- Service role and user (authenticates with a programmatic access token).
CREATE ROLE IF NOT EXISTS CORTEX_CLI_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE CORTEX_CLI_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE CORTEX_CLI_ROLE;
CREATE USER IF NOT EXISTS CORTEX_CLI_USER DEFAULT_ROLE = CORTEX_CLI_ROLE DEFAULT_WAREHOUSE = COMPUTE_WH TYPE = SERVICE;
GRANT ROLE CORTEX_CLI_ROLE TO USER CORTEX_CLI_USER;
-- Then create a PAT for CORTEX_CLI_USER (Snowsight > user > Programmatic access tokens, or
-- ALTER USER CORTEX_CLI_USER ADD PROGRAMMATIC ACCESS TOKEN ...) and put it in both env files.

-- User media (uploads, screenshots, agent artifacts). Server-side encryption is required for
-- the presigned download URLs the app hands out.
CREATE DATABASE IF NOT EXISTS CURIALY_DB;
CREATE STAGE IF NOT EXISTS CURIALY_DB.PUBLIC.USER_MEDIA_STAGE
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE') DIRECTORY = (ENABLE = TRUE);
GRANT USAGE ON DATABASE CURIALY_DB TO ROLE CORTEX_CLI_ROLE;
GRANT USAGE ON SCHEMA CURIALY_DB.PUBLIC TO ROLE CORTEX_CLI_ROLE;
GRANT READ, WRITE ON STAGE CURIALY_DB.PUBLIC.USER_MEDIA_STAGE TO ROLE CORTEX_CLI_ROLE;

-- Smoke tests (as CORTEX_CLI_ROLE):
--   SELECT AI_COMPLETE('gemini-4-argon', 'Reply with READY.');
--   LIST @CURIALY_DB.PUBLIC.USER_MEDIA_STAGE;
