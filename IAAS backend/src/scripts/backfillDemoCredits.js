// Opt-in, one-time backfill: existing users created before demoCredits' default changed from 0 to
// 10 (see User.js, and utils/credits.js for how balances are now spent) may be sitting at a lower
// balance than every new signup now gets. Raises anyone below 10 up to 10 — never lowers anyone
// already above it (e.g. from a previously-granted superadmin credit request). NOT run
// automatically — invoke by hand:
//
//   node src/scripts/backfillDemoCredits.js            # backfill every user
//   node src/scripts/backfillDemoCredits.js --dry-run  # report only, no writes
import { connectDatabase } from '../config/database.js';
import { User } from '../models/User.js';

const dryRun = process.argv.slice(2).includes('--dry-run');

await connectDatabase();

if (dryRun) {
  const affected = await User.countDocuments({ demoCredits: { $lt: 10 } });
  console.log(`${affected} user(s) have demoCredits below 10 and would be raised to 10. (dry run — nothing was written)`);
} else {
  // $max sets each doc's demoCredits to Math.max(current, 10) atomically, server-side, in one round
  // trip for the whole collection — expresses "never lower, only raise" natively instead of a
  // per-doc find/loop/save that could race with concurrent logins or superadmin grants mid-run.
  const result = await User.updateMany({}, { $max: { demoCredits: 10 } });
  console.log(`Backfilled demoCredits: ${result.modifiedCount} user(s) raised to at least 10 (matched ${result.matchedCount}).`);
}

await User.db.close();
