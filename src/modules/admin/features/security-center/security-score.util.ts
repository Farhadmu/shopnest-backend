// Helper functions for security health/score calculations

export function calculateSecurityHealth(data: {
  suspendedUsers: number;
  blockedUsers: number;
  totalUsers: number;
  openIncidents: number;
  criticalIncidents: number;
  failedLogins24h: number;
  rateLimitViolations: number;
  suspiciousActivities: number;
}): number {
  let score = 100;

  const userPenalty = data.totalUsers > 0
    ? ((data.suspendedUsers + data.blockedUsers) / data.totalUsers) * 20
    : 0;
  score -= Math.min(userPenalty, 20);

  score -= Math.min(data.openIncidents * 2, 15);
  score -= Math.min(data.criticalIncidents * 5, 15);
  score -= Math.min(data.failedLogins24h * 0.5, 10);
  score -= Math.min(data.rateLimitViolations * 1, 10);
  score -= Math.min(data.suspiciousActivities * 2, 10);

  return Math.max(0, Math.round(score));
}

export function calculateAuthSecurity(failedLogins: number, totalUsers: number): number {
  let score = 100;
  if (totalUsers > 0) {
    const failRate = failedLogins / totalUsers;
    score -= Math.min(failRate * 100, 30);
  }
  return Math.max(0, Math.round(score));
}

export function calculateAccountSecurity(suspended: number, blocked: number, total: number): number {
  let score = 100;
  if (total > 0) {
    const issueRate = (suspended + blocked) / total;
    score -= Math.min(issueRate * 200, 40);
  }
  return Math.max(0, Math.round(score));
}

export function calculateSellerSecurity(suspended: number, highRisk: number, total: number): number {
  let score = 100;
  if (total > 0) {
    const issueRate = (suspended + highRisk) / total;
    score -= Math.min(issueRate * 150, 40);
  }
  return Math.max(0, Math.round(score));
}

export function calculateApiSecurity(rateLimitViolations: number): number {
  let score = 100;
  score -= Math.min(rateLimitViolations * 2, 30);
  return Math.max(0, Math.round(score));
}

export function calculateIncidentManagement(resolved: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((resolved / total) * 100);
}
