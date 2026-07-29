import { connectDatabase } from '../config/database.js';
import { roles } from '../constants/roles.js';
import { User } from '../models/User.js';

const email = process.env.PROMOTE_EMAIL?.trim().toLowerCase();
const role = process.env.PROMOTE_ROLE?.trim().toLowerCase() || roles.SUPER_ADMIN;

if (!email) {
  console.error('PROMOTE_EMAIL is required.');
  process.exit(1);
}

if (!Object.values(roles).includes(role)) {
  console.error(`Invalid PROMOTE_ROLE: ${role}`);
  process.exit(1);
}

await connectDatabase();

const user = await User.findOne({ email });

if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

user.role = role;
user.status = 'active';
await user.save();

console.log(`Role updated for ${email}: ${role}`);
await User.db.close();
