import mongoose from 'mongoose';

// One row per external login (Google account, GitHub account) linked to a User. Keyed by the
// provider's own immutable account id (`subject` — Google's `sub`, GitHub's numeric `id`), never by
// email: an email address can change hands or change on the provider side, the subject cannot.
const authIdentitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['google', 'github'], required: true },
    subject: { type: String, required: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    name: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

authIdentitySchema.index({ provider: 1, subject: 1 }, { unique: true });

export const AuthIdentity = mongoose.model('AuthIdentity', authIdentitySchema);
