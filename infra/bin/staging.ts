import { App, Tags } from 'aws-cdk-lib';
import { StagingStack } from '../lib/staging-stack';

/**
 * cardsimcha's AWS environments. Today: staging, in the cardsimcha account, in Tel Aviv.
 *   npx cdk deploy -c account=<id> -c adminEmail=<email> [-c budgetEmail=<email>] [-c anthropicSecretName=<name>]
 */
const app = new App();
const account = app.node.tryGetContext('account') ?? process.env.CDK_DEFAULT_ACCOUNT;
const region = app.node.tryGetContext('region') ?? 'il-central-1';
if (!account) throw new Error('Pass the cardsimcha AWS account: -c account=<id> (or sign in to it so CDK_DEFAULT_ACCOUNT is set)');

const staging = new StagingStack(app, 'cardsimcha-staging', {
  env: { account, region },
  description: 'cardsimcha staging: the Next.js app on ECS Fargate behind CloudFront, RDS Postgres, S3 for files',
  adminEmail: app.node.tryGetContext('adminEmail'),
  budgetEmail: app.node.tryGetContext('budgetEmail'),
  anthropicSecretName: app.node.tryGetContext('anthropicSecretName'),
});
Tags.of(staging).add('project', 'cardsimcha');
Tags.of(staging).add('env', 'staging');
