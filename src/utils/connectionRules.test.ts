import { describe, expect, it } from 'vitest';
import { connectionRule, evaluateConnection, typedSourcesFor, typedTargetsFor } from './connectionRules';

describe('connection rules', () => {
  it('reads resolvable-field relationships straight from the shared registry', () => {
    const rule = connectionRule('vpc', 'subnet');
    expect(rule).toMatchObject({ kind: 'resolves', field: 'vpc_id' });

    expect(connectionRule('subnet', 'ec2')).toMatchObject({ kind: 'resolves', field: 'subnet_id' });
    expect(connectionRule('iam', 'lambda')).toMatchObject({ kind: 'resolves', field: 'role_arn' });
  });

  it('covers generator-composed pairs the registry says nothing about', () => {
    expect(connectionRule('eventbridge', 'lambda')).toMatchObject({ kind: 'composes' });
    expect(connectionRule('s3', 'cloudfront')).toMatchObject({ kind: 'composes' });
    expect(connectionRule('kms', 's3')).toMatchObject({ kind: 'composes' });
  });

  it('treats a modelled relationship drawn backwards as reversed, not as a new relationship', () => {
    expect(evaluateConnection('vpc', 'subnet').status).toBe('typed');

    const reversed = evaluateConnection('subnet', 'vpc');
    expect(reversed.status).toBe('reversed');
    // The verdict carries the rule that *would* apply, so the UI can name the correct direction.
    expect(reversed.status === 'reversed' && reversed.rule.field).toBe('vpc_id');
  });

  it('allows unmodelled pairs through as plain references rather than blocking them', () => {
    // 18 registry relations across 14 of 44 resources means most pairs have no rule. Blocking these
    // outright would break diagrams that work today.
    expect(evaluateConnection('cloudwatch', 'dynamodb').status).toBe('reference');
    expect(evaluateConnection('sns', 'redshift').status).toBe('reference');
  });

  it('keeps both directions where the model genuinely needs them', () => {
    // Lambda needs the role ARN; the role needs to know it is being assumed by Lambda.
    expect(evaluateConnection('iam', 'lambda').status).toBe('typed');
    expect(evaluateConnection('lambda', 'iam').status).toBe('typed');
  });

  it('reports modelled neighbours in each direction', () => {
    expect(typedTargetsFor('vpc')).toContain('subnet');
    expect(typedTargetsFor('vpc')).toContain('security-group');
    expect(typedSourcesFor('ec2')).toContain('subnet');
    expect(typedSourcesFor('ec2')).toContain('security-group');
    expect(typedTargetsFor(undefined).size).toBe(0);
  });

  it('has no rule for a service connecting to itself', () => {
    expect(connectionRule('ec2', 'ec2')).toBeUndefined();
  });
});
