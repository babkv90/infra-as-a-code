import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { Diagram } from '../models/Diagram.js';
import { getDashboardModulesForRole, getDashboardPermissionsForRole } from '../constants/dashboardModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getMockAwsInsights } from '../utils/awsInsightsMock.js';

export const getDashboardModules = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: buildDashboardAccess(req.user.role),
  });
});

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const [diagramCount, deploymentCount, accountCount, recentDiagrams, recentDeployments] = await Promise.all([
    Diagram.countDocuments({ workspace: req.user.workspace }),
    Deployment.countDocuments({ workspace: req.user.workspace }),
    AwsAccount.countDocuments({ workspace: req.user.workspace }),
    Diagram.find({ workspace: req.user.workspace }).sort({ updatedAt: -1 }).limit(5),
    Deployment.find({ workspace: req.user.workspace }).sort({ createdAt: -1 }).limit(5),
  ]);

  res.json({
    success: true,
    data: {
      counts: { diagrams: diagramCount, deployments: deploymentCount, awsAccounts: accountCount },
      access: buildDashboardAccess(req.user.role),
      insights: getMockAwsInsights(),
      recentDiagrams,
      recentDeployments,
    },
  });
});

function buildDashboardAccess(role) {
  return {
    role,
    modules: getDashboardModulesForRole(role),
    permissions: getDashboardPermissionsForRole(role),
  };
}
