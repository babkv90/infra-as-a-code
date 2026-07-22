import { connectDatabase } from '../config/database.js';
import { roles } from '../constants/roles.js';
import { User } from '../models/User.js';

const email = 'babkv90@gmail.com';
const password = 'SuperAdmin@123';

await connectDatabase();

const user = await User.findOne({ email }).select('+password');
if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

user.password = password;
user.role = roles.SUPER_ADMIN;
user.status = 'active';
await user.save();

console.log(`Password reset for ${email}`);
await User.db.close();
