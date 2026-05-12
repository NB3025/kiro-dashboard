import * as crypto from 'crypto';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Optional Insights feature configuration. When provided, the ECS task gets
 * additional S3/Glue IAM permissions and environment variables so the
 * `/insights/user/<id>` pipeline can reach prompt logs + the insights bucket.
 * When `undefined` the dashboard still runs, but the Insights section
 * degrades gracefully (isPromptLogsConfigured() returns false).
 */
export interface EcsInsightsConfig {
  /** Raw Kiro prompt log bucket (e.g. `test-kiro-logging-us-east-1`). */
  promptLogsBucket: string;
  /** Prefix within the log bucket down to the per-account KiroLogs tree. */
  promptLogsPrefix: string;
  /** Insights data bucket (Parquet + facets + bundles). Typically
   *  `kiro-insights-<account>-<region>`. */
  insightsBucket: string;
  /** Glue database holding prompt_events / sessions / tool_events tables. */
  athenaDatabase: string;
}

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  albSg: ec2.SecurityGroup;
  ecsSg: ec2.SecurityGroup;
  /**
   * Opt-in: pass this to enable the Insights feature. Omit for the default
   * maintainer deployment which only runs the aggregate dashboards.
   */
  insights?: EcsInsightsConfig;
}

export class EcsStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly customSecret: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    this.customSecret = crypto.randomUUID();

    const nextAuthSecret = new secretsmanager.Secret(this, 'NextAuthSecret', {
      secretName: 'kiro-dashboard/nextauth-secret',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });

    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'kiro-dashboard',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'kiro-dashboard-cluster',
      vpc: props.vpc,
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/kiro-dashboard',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Maintainer defaults — unchanged when no insights config is provided.
    // Fork-local overrides flow in through `props.insights`.
    const athenaResultsBucket = 'whchoi01-titan-q-log';
    const athenaResultsPrefix = 'athena-results';
    const athenaDatabase = props.insights?.athenaDatabase ?? 'titanlog';

    const s3ReadResources = [
      `arn:aws:s3:::${athenaResultsBucket}`,
      `arn:aws:s3:::${athenaResultsBucket}/*`,
    ];
    const s3WriteResources = [
      `arn:aws:s3:::${athenaResultsBucket}/${athenaResultsPrefix}/*`,
    ];
    if (props.insights) {
      s3ReadResources.push(
        `arn:aws:s3:::${props.insights.promptLogsBucket}`,
        `arn:aws:s3:::${props.insights.promptLogsBucket}/*`,
        `arn:aws:s3:::${props.insights.insightsBucket}`,
        `arn:aws:s3:::${props.insights.insightsBucket}/*`,
      );
      s3WriteResources.push(
        `arn:aws:s3:::${props.insights.insightsBucket}/insights/*`,
      );
    }

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        AthenaQuery: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'athena:StartQueryExecution',
                'athena:GetQueryExecution',
                'athena:GetQueryResults',
                'athena:StopQueryExecution',
                'athena:GetWorkGroup',
              ],
              resources: [`arn:aws:athena:*:${this.account}:workgroup/*`],
            }),
          ],
        }),
        S3DataAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation'],
              resources: s3ReadResources,
            }),
            new iam.PolicyStatement({
              actions: ['s3:PutObject', 's3:GetObject'],
              resources: s3WriteResources,
            }),
          ],
        }),
        GlueCatalog: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'glue:GetTable',
                'glue:GetTables',
                'glue:GetDatabase',
                'glue:GetDatabases',
                'glue:GetPartitions',
              ],
              resources: [
                `arn:aws:glue:*:${this.account}:catalog`,
                `arn:aws:glue:*:${this.account}:database/${athenaDatabase}`,
                `arn:aws:glue:*:${this.account}:table/${athenaDatabase}/*`,
              ],
            }),
          ],
        }),
        IdentityStorePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['identitystore:ListUsers', 'identitystore:DescribeUser'],
              resources: ['*'],
            }),
          ],
        }),
        BedrockInvoke: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [
                'arn:aws:bedrock:*::foundation-model/*',
                'arn:aws:bedrock:*:*:inference-profile/*',
              ],
            }),
          ],
        }),
      },
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const baseEnv: Record<string, string> = {
      HOSTNAME: '0.0.0.0',
      AWS_REGION: 'us-east-1',
      ATHENA_DATABASE: athenaDatabase,
      ATHENA_OUTPUT_BUCKET: `s3://${athenaResultsBucket}/${athenaResultsPrefix}/`,
      GLUE_TABLE_NAME: 'user_report',
      IDENTITY_STORE_ID: 'd-90663be888',
      S3_REPORT_PREFIX: 'q-user-log/AWSLogs/120443221648/KiroLogs/user_report/us-east-1/',
      NEXTAUTH_URL: '',
    };

    // Insights-specific env vars only emitted when the feature is opted in.
    // When absent, `isPromptLogsConfigured()` in the app returns false and
    // /insights/* routes respond with not_configured envelopes.
    if (props.insights) {
      baseEnv.PROMPT_LOGS_BUCKET = props.insights.promptLogsBucket;
      baseEnv.PROMPT_LOGS_PREFIX = props.insights.promptLogsPrefix;
      baseEnv.INSIGHTS_BUCKET = props.insights.insightsBucket;
      // Insights bucket lives in this stack's region, different from
      // AWS_REGION=us-east-1 used for Bedrock/Athena/IdC.
      baseEnv.INSIGHTS_BUCKET_REGION = this.region;
      baseEnv.INSIGHTS_MODEL_ID = 'global.anthropic.claude-opus-4-7';
      baseEnv.FACET_MODEL_ID = 'global.anthropic.claude-opus-4-7';
    }

    taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      portMappings: [{ containerPort: 3000 }],
      environment: baseEnv,
      secrets: {
        NEXTAUTH_SECRET: ecs.Secret.fromSecretsManager(nextAuthSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'kiro-dashboard',
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'node -e "const http=require(\'http\');const r=http.get(\'http://localhost:3000/api/health\',res=>{process.exit(res.statusCode===200?0:1)});r.on(\'error\',()=>process.exit(1))"'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: 'kiro-dashboard-alb',
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSg,
      idleTimeout: cdk.Duration.seconds(120),
    });

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    new elbv2.ApplicationListenerRule(this, 'ListenerRule', {
      listener,
      priority: 100,
      conditions: [
        elbv2.ListenerCondition.httpHeader('X-Custom-Secret', [this.customSecret]),
      ],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [props.ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    service.attachToApplicationTargetGroup(targetGroup);

    const scaling = service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    scaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 70 });

    new cdk.CfnOutput(this, 'ALBEndpoint', {
      value: this.alb.loadBalancerDnsName,
      exportName: `${this.stackName}-ALBEndpoint`,
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: repository.repositoryUri,
      exportName: `${this.stackName}-ECRRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'NextAuthSecretArn', {
      value: nextAuthSecret.secretArn,
      exportName: `${this.stackName}-NextAuthSecretArn`,
    });
  }
}
