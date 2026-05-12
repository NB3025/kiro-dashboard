import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InsightsStack } from '../lib/insights-stack';

function synth(props: Partial<ConstructorParameters<typeof InsightsStack>[2]> = {}) {
  const app = new cdk.App();
  const stack = new InsightsStack(app, 'TestInsights', {
    promptLogsBucketName: 'test-kiro-logging',
    insightsBucketName: 'test-kiro-insights',
    ...props,
  });
  return Template.fromStack(stack);
}

describe('InsightsStack — 10.1 Glue database', () => {
  it('creates the titanlog_insights Glue database', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Glue::Database', {
      DatabaseInput: {
        Name: 'titanlog_insights',
      },
    });
  });
});

describe('InsightsStack — 10.2 Glue Python Shell jobs', () => {
  it('creates 3 Python Shell jobs (prompt_etl, session_builder, facet_builder)', () => {
    // Insights Pipeline (see CLAUDE.md): spec/day keying is the canonical
    // session builder (the older 30-min-timeout variant and the transitional
    // session_builder_v2 shim are both gone); clustering was superseded by
    // Opus inline heuristics in section prompts.
    const template = synth();
    const jobs = template.findResources('AWS::Glue::Job');
    const jobNames = Object.values(jobs).map((j: any) => j.Properties?.Name);
    expect(jobNames).toEqual(
      expect.arrayContaining(['prompt_etl', 'session_builder', 'facet_builder'])
    );
    expect(jobNames).not.toContain('clustering');
    expect(jobNames).not.toContain('session_builder_v2');
    expect(jobNames).toHaveLength(3);
  });

  it('each job uses the pythonshell Glue worker type', () => {
    const template = synth();
    const jobs = template.findResources('AWS::Glue::Job');
    for (const job of Object.values(jobs)) {
      expect((job as any).Properties.Command.Name).toBe('pythonshell');
    }
  });

  it('each job passes prompt_parser.py via --extra-py-files so imports resolve', () => {
    const template = synth();
    const jobs = template.findResources('AWS::Glue::Job');
    for (const job of Object.values(jobs)) {
      const args = (job as any).Properties.DefaultArguments;
      expect(args['--extra-py-files']).toContain('prompt_parser.py');
    }
  });
});

describe('InsightsStack — 10.3 Glue Workflows', () => {
  it('creates 1 workflow: daily-etl', () => {
    const template = synth();
    const workflows = template.findResources('AWS::Glue::Workflow');
    const names = Object.values(workflows).map((w: any) => w.Properties?.Name);
    expect(names).toEqual(['daily-etl']);
  });
});

describe('InsightsStack — 10.4 EventBridge rules (EARS-S6-01/02/E3)', () => {
  it('creates only daily-etl rule when cron schedule is NOT set', () => {
    const template = synth();
    const rules = template.findResources('AWS::Events::Rule');
    const names = Object.values(rules).map((r: any) => r.Properties?.Name);
    expect(names).toEqual(['daily-etl']);
    expect(names).not.toContain('bundle-warming');
    expect(names).not.toContain('weekly-clustering');
  });

  it('creates bundle-warming rule when INSIGHTS_CRON_SCHEDULE is provided (EARS-S6-01)', () => {
    const template = synth({ insightsCronSchedule: 'cron(0 23 ? * SUN *)' });
    const rules = template.findResources('AWS::Events::Rule');
    const names = Object.values(rules).map((r: any) => r.Properties?.Name);
    expect(names).toContain('bundle-warming');
  });

  it('throws on CDK synth when insightsCronSchedule is an invalid expression (EARS-S6-E3)', () => {
    expect(() => synth({ insightsCronSchedule: 'not-a-valid-cron' })).toThrow();
  });
});

describe('InsightsStack — 10.5 Glue Job IAM role', () => {
  it('attaches S3 read/write to the insights bucket', () => {
    const template = synth();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:GetObject', 's3:PutObject']),
          }),
        ]),
      },
    });
  });

  it('grants bedrock:InvokeModel', () => {
    const template = synth();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModel',
          }),
        ]),
      },
    });
  });
});

describe('InsightsStack — 10.6 S3 lifecycle (180-day expiration)', () => {
  it('adds a 180-day expiration lifecycle rule to the insights bucket', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            ExpirationInDays: 180,
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });
});

describe('InsightsStack — 10.8 insights env vars for ECS task', () => {
  it('exports INSIGHTS_ECS_ENV map with required keys', () => {
    const { INSIGHTS_ECS_ENV_KEYS } = require('../lib/insights-stack');
    expect(INSIGHTS_ECS_ENV_KEYS).toEqual(
      expect.arrayContaining([
        'PROMPT_LOGS_BUCKET',
        'PROMPT_LOGS_PREFIX',
        'INSIGHTS_BUCKET',
        'INSIGHTS_MODEL_ID',
        'FACET_MODEL_ID',
        'INSIGHTS_CRON_SCHEDULE',
      ])
    );
  });
});
