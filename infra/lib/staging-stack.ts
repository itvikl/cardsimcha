import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';

export type StagingProps = StackProps & {
  /** who becomes admin by registering with this address (ADMIN_EMAIL) */
  adminEmail?: string;
  /** gets an email at 80% of the monthly budget, and when the forecast passes it */
  budgetEmail?: string;
  /** a Secrets Manager secret holding the Anthropic API key, for the assistant and the design import */
  anthropicSecretName?: string;
};

/** characters the database password leaves out, so it goes into DATABASE_URL without escaping */
const PUNCTUATION = ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const DB_NAME = 'cardsimcha';
const DB_USER = 'cardsimcha';
/** the app reads one DATABASE_URL; the parts come in as env and the password as a secret */
const WITH_DATABASE_URL = 'export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"';

/**
 * cardsimcha staging, as the v2 design (docs/design/v2-foundation.md §2), sized small:
 * - a VPC with public subnets for the app and isolated ones for the database; no NAT gateway (the app takes a
 *   public IP to reach the Anthropic API and the image registry)
 * - RDS Postgres 16, db.t4g.micro, 20 GB, single AZ, password in Secrets Manager
 * - a private S3 bucket for files (FILES_DRIVER=s3)
 * - ECS Fargate, 1 vCPU / 2 GB, one task: a start-up container applies the migrations, then the app starts
 * - an Application Load Balancer that only CloudFront can reach, and CloudFront in front for HTTPS on its own
 *   *.cloudfront.net address (no domain yet); the app's sign-in cookie needs HTTPS
 * Turning it off when idle: see infra/README.md.
 */
export class StagingStack extends Stack {
  /** the region's zones, named rather than looked up in the account (synth needs no AWS access) */
  get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: StagingProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret(DB_USER, { excludeCharacters: PUNCTUATION }),
      databaseName: DB_NAME,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(1),
      deletionProtection: false,
      // removing the stack keeps a final snapshot of staging's data
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const bucket = new s3.Bucket(this, 'Files', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // files outlive the stack: delete the bucket by hand when staging is gone for good
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const logGroup = new logs.LogGroup(this, 'Logs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });
    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });

    const repoRoot = path.join(__dirname, '..', '..');
    const image = (target: 'run' | 'migrate') =>
      ecs.ContainerImage.fromAsset(repoRoot, { file: 'Dockerfile', target, platform: Platform.LINUX_AMD64 });
    const dbEnv = { DB_HOST: db.instanceEndpoint.hostname, DB_PORT: db.instanceEndpoint.port.toString(), DB_NAME, DB_USER };
    const dbSecrets = { DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password') };

    const migrate = task.addContainer('migrate', {
      image: image('migrate'),
      essential: false,
      command: ['sh', '-c', `${WITH_DATABASE_URL} && exec npx prisma migrate deploy`],
      environment: dbEnv,
      secrets: dbSecrets,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'migrate' }),
    });

    const anthropic = props.anthropicSecretName ? secretsmanager.Secret.fromSecretNameV2(this, 'Anthropic', props.anthropicSecretName) : undefined;
    const app = task.addContainer('app', {
      image: image('run'),
      command: ['sh', '-c', `${WITH_DATABASE_URL} && exec node server.js`],
      environment: {
        ...dbEnv,
        FILES_DRIVER: 's3',
        S3_BUCKET: bucket.bucketName,
        AWS_REGION: this.region,
        ...(props.adminEmail ? { ADMIN_EMAIL: props.adminEmail } : {}),
      },
      secrets: { ...dbSecrets, ...(anthropic ? { ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropic) } : {}) },
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
    });
    // the app starts only once the migrations went through
    app.addContainerDependencies({ container: migrate, condition: ecs.ContainerDependencyCondition.SUCCESS });
    bucket.grantReadWrite(task.taskRole);

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'App', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      listenerPort: 80,
      // only CloudFront may reach the load balancer (below)
      openListener: false,
      healthCheckGracePeriod: Duration.seconds(180),
      // one task: a deploy starts the new one before stopping the old (0% lets a stuck one be replaced)
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
    });
    service.targetGroup.configureHealthCheck({ path: '/login', healthyHttpCodes: '200', interval: Duration.seconds(30) });
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '15');
    // the design import and the assistant can take a minute or two
    service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '180');
    db.connections.allowDefaultPortFrom(service.service, 'the app');

    // CloudFront's addresses, as AWS publishes them for this region
    const cfPrefixList = new cr.AwsCustomResource(this, 'CloudFrontPrefixList', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: { Filters: [{ Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] }] },
        physicalResourceId: cr.PhysicalResourceId.of('cloudfront-origin-facing'),
        outputPaths: ['PrefixLists.0.PrefixListId'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    service.loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cfPrefixList.getResponseField('PrefixLists.0.PrefixListId')), ec2.Port.tcp(80), 'CloudFront only');

    const lbOrigin = new origins.LoadBalancerV2Origin(service.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      // CloudFront's longest wait without a quota increase
      readTimeout: Duration.seconds(60),
    });
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'cardsimcha staging',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: lbOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // pages are per user: nothing is cached, everything (cookies, headers, query) reaches the app
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        // Next.js's built files carry a hash in their name: safe to cache at the edge
        '/_next/static/*': {
          origin: lbOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    if (props.budgetEmail) {
      new budgets.CfnBudget(this, 'Budget', {
        budget: { budgetName: 'cardsimcha-staging', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 120, unit: 'USD' } },
        notificationsWithSubscribers: [
          { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80 }, subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail }] },
          { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100 }, subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail }] },
        ],
      });
    }

    new CfnOutput(this, 'Url', { value: `https://${cdn.distributionDomainName}`, description: 'the staging site' });
    new CfnOutput(this, 'Bucket', { value: bucket.bucketName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: service.service.serviceName });
    new CfnOutput(this, 'DbInstance', { value: db.instanceIdentifier });
  }
}
