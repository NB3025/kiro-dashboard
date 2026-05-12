// Kiro Insights — CDK stack for ETL/clustering/bundle-warming resources.
// Created in addition to the existing 4 stacks (network/security/ecs/cdn).
// Compatible with upstream: degrades gracefully when PROMPT_LOGS_BUCKET is not
// configured (SC7 / FR-UI-ORG-6).

import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface InsightsStackProps extends cdk.StackProps {
  promptLogsBucketName: string;
  insightsBucketName: string;
  insightsCronSchedule?: string;
}

const GLUE_DATABASE_NAME = 'titanlog_insights';
// Glue jobs for the Insights Pipeline (see CLAUDE.md "Insights Pipeline
// Workflow"):
//   - prompt_etl:       gzipped JSON logs → prompt_events/tool_events Parquet
//   - session_builder:  spec-name/day 2-tier keying → sessions/
//   - facet_builder:    per-session Bedrock call → insights/facets/
const JOB_NAMES = ['prompt_etl', 'session_builder', 'facet_builder'] as const;

// Environment variables that the ECS task needs in order to reach Insights
// resources. `ecs-stack.ts` imports this and injects them into the task
// definition alongside the existing Kiro dashboard env.
export const INSIGHTS_ECS_ENV_KEYS = [
  'PROMPT_LOGS_BUCKET',
  'PROMPT_LOGS_PREFIX',
  'INSIGHTS_BUCKET',
  'INSIGHTS_MODEL_ID',
  'FACET_MODEL_ID',
  'INSIGHTS_CRON_SCHEDULE',
] as const;

export class InsightsStack extends cdk.Stack {
  public readonly database: glue.CfnDatabase;
  public readonly jobs: Record<string, glue.CfnJob>;

  constructor(scope: Construct, id: string, props: InsightsStackProps) {
    super(scope, id, props);

    new s3.Bucket(this, 'InsightsBucket', {
      bucketName: props.insightsBucketName,
      lifecycleRules: [{ expiration: cdk.Duration.days(180), enabled: true }],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.database = new glue.CfnDatabase(this, 'InsightsDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: GLUE_DATABASE_NAME,
        description: 'Kiro Insights — prompt_events, tool_events, sessions, clusters, facets_index',
      },
    });

    const jobRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    jobRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::${props.insightsBucketName}`,
          `arn:aws:s3:::${props.insightsBucketName}/*`,
          `arn:aws:s3:::${props.promptLogsBucketName}`,
          `arn:aws:s3:::${props.promptLogsBucketName}/*`,
        ],
      })
    );

    jobRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );

    this.jobs = {};
    for (const name of JOB_NAMES) {
      this.jobs[name] = new glue.CfnJob(this, `Job_${name}`, {
        name,
        role: jobRole.roleArn,
        glueVersion: '3.0',
        command: {
          name: 'pythonshell',
          pythonVersion: '3.9',
          scriptLocation: `s3://${props.insightsBucketName}/glue-jobs/${name}.py`,
        },
        defaultArguments: {
          '--PROMPT_LOGS_BUCKET': props.promptLogsBucketName,
          '--INSIGHTS_BUCKET': props.insightsBucketName,
          // Glue Python Shell jobs only download the main scriptLocation; any
          // helper module must be listed here so it lands on the job's sys.path.
          // - prompt_parser: shared by prompt_etl
          // - facet_extractor: imported by facet_builder
          '--extra-py-files': [
            `s3://${props.insightsBucketName}/glue-jobs/prompt_parser.py`,
            `s3://${props.insightsBucketName}/glue-jobs/facet_extractor.py`,
          ].join(','),
          // Glue 3.0 Python Shell ships boto3 <1.28 which predates the
          // bedrock-runtime service client. Upgrade via pip at job start.
          '--additional-python-modules': 'boto3==1.34.0',
        },
        maxCapacity: 1,
      });
    }

    new glue.CfnWorkflow(this, 'WorkflowDailyEtl', {
      name: 'daily-etl',
      description: 'Daily: prompt_etl → session_builder → facet_builder',
    });

    // Base EventBridge rule always present. Repetition detection no longer
    // needs a weekly clustering pass — handled inline by Opus via section
    // prompts (CC-style heuristic).
    new events.Rule(this, 'RuleDailyEtl', {
      ruleName: 'daily-etl',
      schedule: events.Schedule.expression('cron(0 5 * * ? *)'),
    });

    // Optional bundle-warming rule (EARS-S6-01/02)
    if (props.insightsCronSchedule) {
      assertValidCronExpression(props.insightsCronSchedule);
      new events.Rule(this, 'RuleBundleWarming', {
        ruleName: 'bundle-warming',
        schedule: events.Schedule.expression(props.insightsCronSchedule),
      });
    }
  }
}

const CRON_EXPRESSION_RE = /^cron\([^)]+\)$/;

function assertValidCronExpression(expr: string): void {
  if (!CRON_EXPRESSION_RE.test(expr)) {
    throw new Error(
      `INSIGHTS_CRON_SCHEDULE must be a cron(...) expression, got "${expr}" (EARS-S6-E3)`
    );
  }
}
