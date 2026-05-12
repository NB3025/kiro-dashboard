-- Athena DDL for the Insights pipeline tables.
--
-- The `KiroDashboardInsights` CDK stack creates the Glue database
-- (`titanlog_insights`) and the S3 bucket that backs these tables, but it
-- does NOT register the Glue Data Catalog tables themselves. Run this
-- script once in Athena (workgroup that writes to your ATHENA_OUTPUT_BUCKET)
-- after the first `prompt_etl` + `session_builder` jobs have written
-- Parquet to S3.
--
-- Cross-region note: the CDK stack deploys to your infra region
-- (ap-northeast-2 by default) but the ECS task queries Athena in
-- AWS_REGION (us-east-1). Glue databases are region-scoped, so the
-- first CREATE DATABASE below is required even though the CDK also
-- created one in the infra region.
--
-- Replace <INSIGHTS_BUCKET> below with the bucket created by the stack,
-- e.g. `kiro-insights-<account>-<region>`. Partition projection is used
-- so no `MSCK REPAIR TABLE` is needed after new date partitions land.
--
-- How to run:
--   The Athena **web console** accepts all statements in one paste.
--   The `aws athena start-query-execution` CLI only runs the first
--   statement per call — if you prefer CLI, loop over the four
--   statements below separately (see docs/insights-setup.md step 5).

CREATE DATABASE IF NOT EXISTS titanlog_insights;

CREATE EXTERNAL TABLE IF NOT EXISTS titanlog_insights.prompt_events (
  request_id STRING,
  user_id STRING,
  session_id STRING,
  timestamp STRING,
  model_id STRING,
  chat_trigger_type STRING,
  client_type STRING,
  prompt_length BIGINT,
  response_length BIGINT,
  prompt STRING,
  clean_prompt STRING,
  steering_rules ARRAY<STRUCT<id:STRING, content:STRING>>,
  active_editor_file STRING,
  workspace_path STRING,
  is_spec_mode BOOLEAN,
  active_spec_phase STRING,
  active_spec_name STRING,
  schema_version STRING
)
PARTITIONED BY (date STRING)
STORED AS PARQUET
LOCATION 's3://<INSIGHTS_BUCKET>/prompt_events/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.date.type'='date',
  'projection.date.format'='yyyy-MM-dd',
  'projection.date.range'='2025-01-01,NOW',
  'storage.location.template'='s3://<INSIGHTS_BUCKET>/prompt_events/date=${date}/'
);

CREATE EXTERNAL TABLE IF NOT EXISTS titanlog_insights.tool_events (
  request_id STRING,
  user_id STRING,
  timestamp STRING,
  response_length BIGINT,
  schema_version STRING
)
PARTITIONED BY (date STRING)
STORED AS PARQUET
LOCATION 's3://<INSIGHTS_BUCKET>/tool_events/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.date.type'='date',
  'projection.date.format'='yyyy-MM-dd',
  'projection.date.range'='2025-01-01,NOW',
  'storage.location.template'='s3://<INSIGHTS_BUCKET>/tool_events/date=${date}/'
);

CREATE EXTERNAL TABLE IF NOT EXISTS titanlog_insights.sessions (
  user_id STRING,
  session_id STRING,
  tier STRING,
  spec_name STRING,
  day STRING,
  start_ts BIGINT,
  end_ts BIGINT,
  event_count BIGINT
)
PARTITIONED BY (date STRING)
STORED AS PARQUET
LOCATION 's3://<INSIGHTS_BUCKET>/sessions/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.date.type'='date',
  'projection.date.format'='yyyy-MM-dd',
  'projection.date.range'='2025-01-01,NOW',
  'storage.location.template'='s3://<INSIGHTS_BUCKET>/sessions/date=${date}/'
);
