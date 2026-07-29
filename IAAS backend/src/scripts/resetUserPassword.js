import { connectDatabase } from '../config/database.js';
import { User } from '../models/User.js';

const email = process.env.RESET_EMAIL?.trim().toLowerCase();
const password = process.env.RESET_PASSWORD;

if (!email || !password) {
  console.error('RESET_EMAIL and RESET_PASSWORD are required.');
  process.exit(1);
}

await connectDatabase();

const user = await User.findOne({ email }).select('+password +passwordResetToken +passwordResetExpires');

if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

user.password = password;
user.status = 'active';
user.passwordResetToken = undefined;
user.passwordResetExpires = undefined;
await user.save();

console.log(`Password reset for ${email}`);
await User.db.close();
