import { createNotification } from './notificationService.js';

// Shared by BOTH terraformDeploymentRunner.js (local executor) and githubTerraformRunner.js
// (github-actions executor) — this is the single place the pre-execution gate and the
// auto-destroy-on-failure decision live. Two independent copies of this logic is exactly the kind of
// thing that silently drifts out of sync over time (same risk category as duplicated Terraform
// generators); every executor must call these same functions rather than reimplementing them.

export async function assertDeployable(deployment, { applyEnabled, disabledMessage, phase }) {
  if (!applyEnabled) {
    await failDeployment(deployment, disabledMessage, phase);
    return false;
  }

  if (deployment.validationIssues.some((issue) => issue.severity === 'error')) {
    await failDeployment(deployment, 'Deployment has blocking validation errors.', phase);
    return false;
  }

  return true;
}

export async function failDeployment(deployment, message, phase = 'deploy', { auto = false } = {}) {
  const finalMessage = addPermissionHint(stripAnsi(message));
  deployment.status = 'failed';
  deployment.finishedAt = new Date();
  deployment.activeRun = undefined; // this run has reached a terminal outcome — nothing left to reconcile after a restart
  deployment.logs.push({ message: finalMessage, level: 'error' });
  await deployment.save();

  await createNotification({
    workspace: deployment.workspace,
    type: phase === 'destroy' ? 'destroy' : 'deployment',
    status: 'failed',
    title:
      phase === 'destroy'
        ? auto
          ? `Automatic cleanup failed for "${deployment.name}" - resources may still exist in AWS`
          : `Destroy failed for "${deployment.name}"`
        : phase === 'update'
          ? `Update failed for "${deployment.name}" - previous infrastructure was left untouched`
          : `Deployment "${deployment.name}" failed`,
    message: auto ? `Automatic cleanup after the failed deployment did not finish: ${finalMessage.slice(0, 220)}` : finalMessage.slice(0, 300),
    errorLog: finalMessage,
    resourceType: 'Deployment',
    resourceId: deployment._id,
    resourceName: deployment.name,
  });
}

// The single most safety-critical decision in this whole pipeline: after a deploy/update attempt
// fails, should AWS resources it may have already created be automatically torn down? Both executors
// call this exact function so the decision itself can never diverge between them — only *how* each
// executor checks for real state or runs its own destroy differs, via the injected callbacks below.
//
//   hasRealState()     — async () => boolean. Did this attempt get far enough to create real state?
//   runAutoDestroy()    — async () => void. Trigger this executor's own destroy path, {force:true, auto:true}.
//   cleanupArtifacts()  — async () => void. Best-effort, executor-specific cleanup (e.g. local provider
//                         cache removal); called in every branch except the isUpdate one, which
//                         deliberately leaves things untouched for inspection.
export async function handleDeployFailureCleanup({ deployment, isUpdate, hasRealState, runAutoDestroy, cleanupArtifacts }) {
  // Auto-destroy-on-failure only makes sense for a first-time create: there's nothing working yet to
  // protect. For an update to already-running infrastructure, a failed apply must NOT trigger a full
  // teardown — that would destroy resources that were working fine before this update was attempted.
  const createdRealState = !isUpdate && (await hasRealState());

  if (!isUpdate && createdRealState) {
    deployment.logs.push({
      message: 'Automatically destroying any AWS resources created before this failure, to avoid leaving orphaned infrastructure behind.',
      level: 'warning',
    });
    await deployment.save();
    try {
      await runAutoDestroy();
    } finally {
      await cleanupArtifacts();
    }
    return;
  }

  if (isUpdate) {
    deployment.logs.push({
      message: 'This update failed. Nothing was automatically destroyed since infrastructure from before this update may still be running — check Terraform state and the AWS console before retrying.',
      level: 'warning',
    });
    await deployment.save();
    return;
  }

  await cleanupArtifacts();
}

export function stripAnsi(value = '') {
  return String(value).replace(new RegExp(String.fromCharCode(27) + '\[[0-9;]*m', 'g'), '');
}

export function addPermissionHint(message) {
  if (message.includes('ec2:DescribeInstanceAttribute')) {
    return `${message}\n\nFix: add ec2:DescribeInstanceAttribute to the IAM policy attached to the connected AWS role, then rerun deployment. Terraform creates the EC2 instance first, then reads this attribute to complete state refresh.`;
  }

  if (message.includes('ec2:DescribeVpcAttribute')) {
    return `${message}\n\nFix: add ec2:DescribeVpcAttribute to the IAM policy attached to the connected AWS role, then rerun deployment. Terraform reads default VPC DNS attributes while planning resources that reference data.aws_vpc.default.`;
  }

  if (message.includes('iam:GetRole')) {
    return `${message}\n\nFix: add iam:GetRole to the IAM policy attached to the connected AWS role, then rerun deployment. EC2 deployments with an IAM role need Terraform to read that role before creating or attaching an instance profile. You will also need iam:PassRole and instance-profile permissions if the EC2 node uses an IAM role.`;
  }

  if (message.includes('iam:CreateInstanceProfile')) {
    return `${message}\n\nFix: add iam:CreateInstanceProfile to the IAM policy attached to the connected AWS role, then rerun deployment. EC2 deployments with an IAM role need Terraform to create an instance profile before attaching the role to the instance. You will also need iam:AddRoleToInstanceProfile and iam:PassRole.`;
  }

  if (message.includes('ec2:CreateSecurityGroup')) {
    return `${message}\n\nFix: add ec2:CreateSecurityGroup to the IAM policy attached to the connected AWS role, then rerun deployment. If Terraform manages security group rules, also allow ec2:AuthorizeSecurityGroupIngress, ec2:AuthorizeSecurityGroupEgress, ec2:RevokeSecurityGroupIngress, ec2:RevokeSecurityGroupEgress, and ec2:DeleteSecurityGroup.`;
  }

  return message;
}
