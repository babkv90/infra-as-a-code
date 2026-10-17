import mongoose from 'mongoose';

// One row per in-flight OAuth sign-in hand-off (services/oauthLogin.js). Its own collection rather
// than fields on User so two sign-ins for the same person — two devices, two tabs — each get their
// own ticket instead of the second silently overwriting the first.
const oauthLoginTicketSchema = new mongoose.Schema({
  // SHA-256 of the ticket; the ticket itself is never stored.
  ticketHash: { type: String, required: true, unique: true },
  // PKCE-style challenge of the browser tab that started the sign-in; redeeming needs its verifier.
  clientChallenge: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Shown once on the login page after redeeming (e.g. 'password_removed'); never free text.
  notice: { type: String, enum: ['password_removed', null], default: null },
  // TTL index: MongoDB deletes expired rows on its own (its sweeper runs about once a minute, so
  // redeemLoginTicket() still checks expiresAt itself).
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

export const OAuthLoginTicket = mongoose.model('OAuthLoginTicket', oauthLoginTicketSchema);
