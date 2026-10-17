import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { roles } from '../constants/roles.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Absent for accounts that only ever signed in with Google/GitHub (models/AuthIdentity.js). Such a
    // user can still add one later through forgot-password, which proves they own the inbox.
    password: { type: String, minlength: 8, select: false },
    // True once this person has proven they control `email`: a provider-verified email at OAuth
    // sign-in, or a completed password reset. Plain registration doesn't verify it — which is exactly
    // why services/oauthLogin.js treats an unverified password account specially when linking.
    emailVerified: { type: Boolean, default: false },
    // Embedded as `sv` in every access/refresh token (utils/tokens.js). Bumping it revokes every
    // session issued before — stateless JWTs otherwise stay valid until they expire.
    sessionVersion: { type: Number, default: 0 },
    role: { type: String, enum: Object.values(roles), default: roles.VIEWER },
    status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active' },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
    // Universal credit balance, not demo-specific despite the field name (kept as-is to avoid a
    // document-key migration) — every user starts with 10 and spends 1 per successful deploy,
    // destroy, application-pipeline run, or AWS drift sync. See utils/credits.js.
    demoCredits: { type: Number, default: 10, min: 0 },
    creditRequest: {
      status: { type: String, enum: ['none', 'pending', 'granted', 'rejected'], default: 'none' },
      requestedCredits: { type: Number, default: 0, min: 0 },
      reason: { type: String, default: '' },
      requestedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, default: '' },
    },
    githubConnection: {
      accessToken: { type: String, select: false },
      login: { type: String, default: '' },
      name: { type: String, default: '' },
      avatarUrl: { type: String, default: '' },
      scopes: { type: [String], default: [] },
      connectedAt: Date,
    },
    legalConsent: {
      termsVersionAccepted: { type: String, default: '' },
      privacyVersionAccepted: { type: String, default: '' },
      acceptedAt: Date,
      acceptedIp: { type: String, default: '' },
    },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.pre('save', async function hashPassword(next) {
  // `!this.password`: clearing the password (services/oauthLogin.js) is a modification with nothing to hash.
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, env.BCRYPT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model('User', userSchema);
