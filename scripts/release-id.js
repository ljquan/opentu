function sanitizeReleaseRef(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 24);
}

function createReleaseId(version, environment = process.env, now = new Date()) {
  const deploymentRef =
    environment.DEPLOY_ID ||
    environment.COMMIT_REF ||
    environment.GITHUB_SHA ||
    now.toISOString().replace(/\D/g, '');
  const releaseRef = sanitizeReleaseRef(deploymentRef);

  return `${version}-${releaseRef}`;
}

module.exports = {
  createReleaseId,
  sanitizeReleaseRef,
};
