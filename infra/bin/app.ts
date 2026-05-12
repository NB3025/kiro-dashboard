#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { SecurityStack } from '../lib/security-stack';
import { EcsStack } from '../lib/ecs-stack';
import { CdnStack } from '../lib/cdn-stack';
import { InsightsStack } from '../lib/insights-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-2',
};

const networkStack = new NetworkStack(app, 'KiroDashboardNetwork', {
  env,
  description: 'Kiro Dashboard - VPC and networking',
});

const securityStack = new SecurityStack(app, 'KiroDashboardSecurity', {
  env,
  description: 'Kiro Dashboard - Security groups, Cognito',
  vpc: networkStack.vpc,
});

// Kiro Insights — ETL + clustering + bundle-warming resources.
// Deploys in the same region as the main infra (ap-northeast-2) for repo
// consistency. Glue jobs access PROMPT_LOGS_BUCKET in us-east-1 cross-region,
// matching the existing ECS task pattern (AWS_REGION=us-east-1 for Bedrock /
// Athena calls).
const promptLogsBucketName = process.env.PROMPT_LOGS_BUCKET_NAME;
const promptLogsPrefix =
  process.env.PROMPT_LOGS_PREFIX ??
  (env.account
    ? `kiro-logging/AWSLogs/${env.account}/KiroLogs/GenerateAssistantResponse`
    : undefined);
const insightsBucketName =
  process.env.INSIGHTS_BUCKET_NAME ??
  (env.account ? `kiro-insights-${env.account}-${env.region}` : undefined);
const insightsCronSchedule = process.env.INSIGHTS_CRON_SCHEDULE;
const athenaDatabase = process.env.ATHENA_DATABASE_NAME ?? 'titanlog_insights';

// Insights feature is opt-in: set PROMPT_LOGS_BUCKET_NAME to a real bucket
// to enable. When unset, the ECS task still boots but /insights routes
// respond with not_configured envelopes.
const insightsConfig =
  promptLogsBucketName && insightsBucketName && promptLogsPrefix
    ? {
        promptLogsBucket: promptLogsBucketName,
        promptLogsPrefix,
        insightsBucket: insightsBucketName,
        athenaDatabase,
      }
    : undefined;

const ecsStack = new EcsStack(app, 'KiroDashboardEcs', {
  env,
  description: 'Kiro Dashboard - ECS Fargate, ALB, Auto Scaling',
  vpc: networkStack.vpc,
  albSg: securityStack.albSg,
  ecsSg: securityStack.ecsSg,
  insights: insightsConfig,
});

new CdnStack(app, 'KiroDashboardCdn', {
  env,
  description: 'Kiro Dashboard - CloudFront distribution + Lambda@Edge auth',
  alb: ecsStack.alb,
  customSecret: ecsStack.customSecret,
  userPool: securityStack.userPool,
  edgeClientId: securityStack.edgeClientId,
  userPoolDomain: `kiro-dashboard-${env.account}`,
});

if (promptLogsBucketName && insightsBucketName) {
  new InsightsStack(app, 'KiroDashboardInsights', {
    env,
    description: 'Kiro Dashboard - Insights ETL + clustering',
    promptLogsBucketName,
    insightsBucketName,
    insightsCronSchedule,
  });
}

app.synth();
