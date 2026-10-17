// Credentials are loaded by systemd, never passed in command arguments.
async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) throw new Error('Missing maintenance configuration');
  const response = await fetch(process.env.OPENTU_MAINTENANCE_URL || 'http://127.0.0.1:3101/api/internal/generation-maintenance', {
    headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Maintenance HTTP ${response.status}`);
  const payload = await response.json();
  console.log('Maintenance completed; reconciled:', Number(payload?.data?.reconciled) || 0);
}
main().catch(() => { console.error('Maintenance failed; check API and database readiness.'); process.exitCode = 1; });
