import { hashPassword } from './core/staff-auth.js';

// `pnpm --filter @myna/api run hash-password <clinicId> <password>`
// Prints the CLINIC_LOGINS entry to put in .env (or Secret Manager). The password never leaves
// this machine and is never stored in plain text.
const [clinicId, password] = process.argv.slice(2);
if (!clinicId || !password || password.length < 10) {
  console.error('usage: hash-password <clinicId> <password (10+ characters)>');
  process.exit(2);
}
console.log(`${clinicId}=${hashPassword(password)}`);
