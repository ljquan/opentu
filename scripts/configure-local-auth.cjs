const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const directory = '/etc/opentu';
const path = `${directory}/auth-secret`;
if (!fs.existsSync(path)) fs.writeFileSync(path, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 });
const secret = fs.readFileSync(path, 'utf8').trim();
for (const name of ['migration', 'runtime']) {
  const envPath = `${directory}/${name}.env`;
  const additions = { OPENTU_AUTH_MODE: 'local', BETTER_AUTH_URL: 'http://localhost:7310', BETTER_AUTH_SECRET: secret, OPENTU_REGISTRATION_ENABLED: 'true' };
  let text = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(additions)) {
    if (!text.split('\n').some((line) => line.startsWith(`${key}=`))) text += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, `${text.trim()}\n`, { mode: 0o600 });
}
console.log('Local account environment configured for SSH-only staging. No secrets printed.');
