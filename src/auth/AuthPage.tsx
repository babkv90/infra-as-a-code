import { ArrowLeft, ArrowRight, CloudCog, Eye, EyeOff, Github, LockKeyhole, Mail, UserRound, Workflow, Code2, Database, Globe, Zap, LoaderCircle } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { PageAlert } from '../components/PageAlert';
import { DASHBOARD_ROUTE, LOGIN_ROUTE, REGISTER_ROUTE } from '../landing/landingConfig';
import { getThemeToggleLabel, type ThemeMode } from '../theme';
import {
  completeOAuthSignIn,
  fetchOAuthProviders,
  forgotPassword,
  login,
  register,
  resetPassword,
  startOAuthSignIn,
  type OAuthProvider,
} from './authClient';
import AppLogo from '../components/AppLogo';
import { useUiExperience } from '../ui/UiExperience';
import { ThemePicker } from '../ui/ThemePicker';

type AuthMode = 'login' | 'register';
type AuthFieldErrors = Partial<Record<'name' | 'email' | 'password' | 'legal', string>>;

function AuthPage({ mode, theme, onToggleTheme, onSelectTheme }: { mode: AuthMode; theme: ThemeMode; onToggleTheme: () => void; onSelectTheme: (theme: ThemeMode) => void }) {
  const { experience } = useUiExperience();
  const isStudio = experience !== 'classic';
  const FormHeading = isStudio ? 'h1' : 'h2';
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [hasAcceptedLegal, setHasAcceptedLegal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');
  const [forgotPasswordToken, setForgotPasswordToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [isRequestingReset, setIsRequestingReset] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProvider[]>([]);
  // Provider id while redirecting out to it, 'completing' while redeeming the ticket on the way back.
  const [oauthPending, setOAuthPending] = useState<OAuthProvider['id'] | 'completing' | null>(null);
  // Where to continue to once the user has read the "password removed" notice; null = no notice.
  const [oauthNoticeTarget, setOAuthNoticeTarget] = useState<string | null>(null);

  const title = isStudio ? (isRegister ? 'Create your account' : 'Welcome back') : isRegister ? 'Create your infraflow account' : 'Login to infraflow';
  const description = isStudio ? (isRegister ? 'Your next architecture starts here.' : 'Sign in to continue to your workspace.') : isRegister
    ? 'Register your workspace and start designing AWS infrastructure visually.'
    : 'Access your diagrams, Terraform exports, AWS insights, and AI cloud agent.';

  const canRequestPasswordReset = !isRegister && email.trim().length > 0 && !isRequestingReset;
  const canResetPassword = !isRegister && resetToken.trim().length >= 32 && resetNewPassword.length >= 8 && !isResettingPassword;

  useEffect(() => {
    if (isRegister) return;
    const token = new URLSearchParams(window.location.search).get('resetToken')?.trim();
    if (!token) return;
    setShowForgotPassword(true);
    setResetToken(token);
  }, [isRegister]);

  useEffect(() => {
    let isCurrent = true;
    void fetchOAuthProviders().then((providers) => {
      if (isCurrent) setOAuthProviders(providers);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  // Landing back from Google/GitHub: /login#oauth_ticket=…&next=… on success, ?oauth_error=… on failure.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const ticket = fragment.get('oauth_ticket');
    const oauthError = query.get('oauth_error');
    if (!ticket && !oauthError) return;

    // Strip it from the address bar (and history) before anything async, so the ticket can't be
    // bookmarked, shared, or read back — and so StrictMode's second effect run finds nothing to redeem.
    query.delete('oauth_error');
    const remainingQuery = query.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}`);

    if (oauthError) {
      setError(oauthErrorMessage(oauthError));
      return;
    }

    setOAuthPending('completing');
    completeOAuthSignIn(ticket as string)
      .then((session) => {
        const next = fragment.get('next');
        const target = next?.startsWith('/') && !next.startsWith('//') ? next : DASHBOARD_ROUTE;
        if (session.notice === 'password_removed') {
          // Signed in, but hold here: the user must learn their password stopped working now, not
          // the next time they try it.
          setOAuthPending(null);
          setOAuthNoticeTarget(target);
          return;
        }
        window.location.href = target;
      })
      .catch((oauthCompleteError) => {
        setOAuthPending(null);
        setError(oauthCompleteError instanceof Error ? oauthCompleteError.message : 'Sign-in failed. Please try again.');
      });
  }, []);

  async function handleOAuthSignIn(providerId: OAuthProvider['id']) {
    if (oauthPending) return;
    setError('');
    setOAuthPending(providerId);
    try {
      await startOAuthSignIn(providerId, getAuthRedirectTarget());
    } catch {
      setOAuthPending(null);
      setError('Could not start sign-in. Please try again.');
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const validationErrors = validateAuthForm({ email, hasAcceptedLegal, isRegister, name, password });
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.auth-form input[aria-invalid="true"]')?.focus());
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      if (isRegister) {
        await register({
          name: name.trim(),
          workspaceName: workspaceName.trim() || undefined,
          email: email.trim(),
          password,
          acceptTerms: true,
        });
      } else {
        await login({ email: email.trim(), password });
      }

      window.location.href = getAuthRedirectTarget();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    if (!canRequestPasswordReset) return;

    setError('');
    setForgotPasswordMessage('');
    setForgotPasswordToken('');
    setIsRequestingReset(true);

    try {
      const result = await forgotPassword({ email: email.trim() });
      setForgotPasswordMessage(result.message ?? 'If an account exists for this email, password reset instructions will be sent.');
      const token = result.data?.resetToken ?? '';
      setForgotPasswordToken(token);
      setResetToken(token);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not request password reset. Please try again.');
    } finally {
      setIsRequestingReset(false);
    }
  }

  async function handleResetPassword() {
    if (!canResetPassword) return;

    setError('');
    setForgotPasswordMessage('');
    setIsResettingPassword(true);

    try {
      const result = await resetPassword({ token: resetToken.trim(), password: resetNewPassword });
      setForgotPasswordMessage(result.message ?? 'Password has been reset. Please log in with your new password.');
      setPassword(resetNewPassword);
      setResetToken('');
      setForgotPasswordToken('');
      setResetNewPassword('');
      setShowForgotPassword(false);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset password. Please request a new token.');
    } finally {
      setIsResettingPassword(false);
    }
  }

  return (
    <main className="auth-page">
      {forgotPasswordMessage && <PageAlert message={forgotPasswordMessage} onDismiss={() => setForgotPasswordMessage('')} />}
      {error && !isStudio && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      {isStudio && <header className="studio-auth-header"><a href="/" aria-label="CodeManus home"><AppLogo /></a><div><a className="auth-back-link" href="/"><ArrowLeft size={15} />Back to home</a><ThemePicker theme={theme} onChange={onSelectTheme} /></div></header>}
      {isStudio ? <StudioAuthStory /> : <section className="auth-panel">
        <a className="auth-back-link" href="/">
          <ArrowLeft size={16} />
          Back to home
        </a>
        <h1>{isRegister ? 'Build AWS infrastructure with your first workspace.' : 'Welcome back to your cloud workspace.'}</h1>
        <p>
          Design visual infrastructure, validate architecture risk, generate Terraform, and monitor connected AWS
          accounts from one dashboard.
        </p>
        <div className="auth-proof-grid">
          <span>
            <LockKeyhole size={15} />
            Role-based access
          </span>
          <span>
            <CloudCog size={15} />
            Visual AWS builder
          </span>
          <span>
            <ArrowRight size={15} />
            Terraform export
          </span>
        </div>
      </section>}

      <section className="auth-card">
        <div className="auth-card-header">
          <div>
            <span className="auth-eyebrow">{isStudio ? 'YOUR CODEMANUS WORKSPACE' : isRegister ? 'Register' : 'Login'}</span>
            <FormHeading>{title}</FormHeading>
            <p>{description}</p>
          </div>
          {!isStudio && <button className="auth-theme-button" onClick={onToggleTheme} type="button">
            {getThemeToggleLabel(theme)}
          </button>}
        </div>

        {oauthNoticeTarget && (
          <div className="auth-oauth-notice" role="alert">
            <strong>You’re signed in. One thing changed on your account.</strong>
            <p>
              The password on this account has been removed. Its email address had never been verified, so we couldn’t be
              sure that password was set by you. Keep signing in with Google or GitHub, or use “Forgot password?” on this
              page any time to set a new password.
            </p>
            <button className="auth-submit" onClick={() => (window.location.href = oauthNoticeTarget)} type="button">
              Continue <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}

        {oauthProviders.length > 0 && !oauthNoticeTarget && (
          <div className="auth-oauth" aria-busy={Boolean(oauthPending)}>
            {oauthProviders.map((provider) => (
              <button
                className="auth-oauth-button"
                disabled={Boolean(oauthPending)}
                key={provider.id}
                onClick={() => void handleOAuthSignIn(provider.id)}
                type="button"
              >
                {oauthPending === provider.id ? (
                  <LoaderCircle className="studio-auth-spinner" size={18} aria-hidden="true" />
                ) : provider.id === 'google' ? (
                  <GoogleMark />
                ) : (
                  <Github size={18} aria-hidden="true" />
                )}
                Continue with {provider.name}
              </button>
            ))}
            {oauthPending === 'completing' && (
              <p className="auth-oauth-status" role="status">
                <LoaderCircle className="studio-auth-spinner" size={15} aria-hidden="true" /> Signing you in…
              </p>
            )}
            <p className="auth-oauth-legal">
              By continuing with {oauthProviders.map((provider) => provider.name).join(' or ')}, you agree to the{' '}
              <a href="/legal/terms" rel="noreferrer" target="_blank">Terms of Service</a> and{' '}
              <a href="/legal/privacy" rel="noreferrer" target="_blank">Privacy Policy</a>.
            </p>
            <div className="auth-oauth-divider" role="separator">
              <span>or {isRegister ? 'sign up' : 'sign in'} with email</span>
            </div>
          </div>
        )}

        <form className="auth-form" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting}>
          {isStudio && error && <div className="studio-auth-error" role="alert">{error}</div>}
          {isRegister && (
            <>
              <label className="auth-field">
                <span id="auth-name-label">Full name</span>
                <div>
                  <UserRound size={17} />
                  <input
                    name="name"
                    required
                    aria-labelledby="auth-name-label"
                    aria-describedby={fieldErrors.name ? 'auth-name-error' : undefined}
                    aria-invalid={Boolean(fieldErrors.name)}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      clearFieldError('name');
                    }}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
                {fieldErrors.name && (
                  <span className="auth-field-error" id="auth-name-error">
                    {fieldErrors.name}
                  </span>
                )}
              </label>
              <label className="auth-field">
                <span>Workspace name{isStudio && <small> (optional)</small>}</span>
                <div>
                  <CloudCog size={17} />
                  <input
                    name="organization"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    placeholder="Acme cloud platform"
                    autoComplete="organization"
                  />
                </div>
              </label>
            </>
          )}

          <label className="auth-field">
            <span id="auth-email-label">Email address</span>
            <div>
              <Mail size={17} />
              <input
                id="auth-email"
                name="email"
                required
                aria-labelledby="auth-email-label"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                aria-invalid={Boolean(fieldErrors.email)}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError('email');
                }}
                placeholder="you@company.com"
                autoComplete={isRegister ? 'email' : 'username'}
                type="email"
              />
            </div>
            {fieldErrors.email && (
              <span className="auth-field-error" id="auth-email-error">
                {fieldErrors.email}
              </span>
            )}
          </label>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <div>
              <LockKeyhole size={17} />
              <input
                id="auth-password"
                name="password"
                required
                aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                aria-invalid={Boolean(fieldErrors.password)}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError('password');
                }}
                placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                type={showPassword ? 'text' : 'password'}
              />
              <button className="auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldErrors.password && (
              <span className="auth-field-error" id="auth-password-error">
                {fieldErrors.password}
              </span>
            )}
          </div>

          {!isRegister && (
            <div className="auth-forgot">
              <button
                className="auth-link-button"
                aria-expanded={showForgotPassword}
                aria-controls="auth-password-recovery"
                onClick={() => {
                  setShowForgotPassword((value) => !value);
                  setForgotPasswordMessage('');
                  setForgotPasswordToken('');
                  setResetToken('');
                  setResetNewPassword('');
                }}
                type="button"
              >
                {isStudio ? 'Forgot password?' : 'Reset password'}
              </button>

              {showForgotPassword && (
                <div className="auth-forgot-panel" id="auth-password-recovery">
                  <p>Enter your email above, then use the emailed reset token or reset link to set a new password here.</p>
                  <button className="auth-secondary-submit" disabled={!canRequestPasswordReset} onClick={handleForgotPassword} type="button">
                    {isRequestingReset ? 'Sending...' : 'Send reset token'}
                    <Mail size={16} />
                  </button>
                  {forgotPasswordToken && (
                    <div className="auth-reset-token">
                      <span>Reset token</span>
                      <code>{forgotPasswordToken}</code>
                    </div>
                  )}
                  <div className="auth-reset-form">
                    <label className="auth-field">
                      <span>Reset token</span>
                      <div>
                        <LockKeyhole size={17} />
                        <input
                          value={resetToken}
                          onChange={(event) => setResetToken(event.target.value)}
                          placeholder="Paste reset token"
                          autoComplete="one-time-code"
                        />
                      </div>
                    </label>
                    <label className="auth-field">
                      <span>New password</span>
                      <div>
                        <LockKeyhole size={17} />
                        <input
                          value={resetNewPassword}
                          onChange={(event) => setResetNewPassword(event.target.value)}
                          placeholder="Minimum 8 characters"
                          autoComplete="new-password"
                          type="password"
                        />
                      </div>
                    </label>
                    <button className="auth-secondary-submit" disabled={!canResetPassword} onClick={handleResetPassword} type="button">
                      {isResettingPassword ? 'Resetting...' : 'Set new password'}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isRegister && (
            <label className="auth-consent">
              <input
                aria-describedby={fieldErrors.legal ? 'auth-legal-error' : undefined}
                aria-invalid={Boolean(fieldErrors.legal)}
                checked={hasAcceptedLegal}
                onChange={(event) => {
                  setHasAcceptedLegal(event.target.checked);
                  clearFieldError('legal');
                }}
                type="checkbox"
              />
              <span>
                I agree to the{' '}
                <a href="/legal/terms" rel="noreferrer" target="_blank">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/legal/privacy" rel="noreferrer" target="_blank">
                  Privacy Policy
                </a>
                .
              </span>
              {fieldErrors.legal && (
                <span className="auth-field-error auth-field-error--consent" id="auth-legal-error">
                  {fieldErrors.legal}
                </span>
              )}
            </label>
          )}

          <button className="auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? (isRegister ? 'Creating account…' : 'Signing in…') : isRegister ? 'Create account' : isStudio ? 'Sign in' : 'Login'}
            {isSubmitting ? <LoaderCircle className="studio-auth-spinner" size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : isStudio ? 'New to CodeManus?' : 'New to infraflow?'}
          <a href={isRegister ? LOGIN_ROUTE : REGISTER_ROUTE}>{isRegister ? ' Login' : ' Create account'}</a>
        </p>
        {isStudio && <div className="studio-auth-legal"><a href="/legal/terms">Terms of Service</a><span aria-hidden="true">·</span><a href="/legal/privacy">Privacy Policy</a></div>}
      </section>
    </main>
  );

  function clearFieldError(field: keyof AuthFieldErrors) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
}

function StudioAuthStory() {
  return <section className="studio-auth-story" aria-labelledby="studio-auth-story-title">
    <div className="studio-auth-story-copy"><span className="studio-auth-kicker"><span />ARCHITECTURE STUDIO</span><h2 id="studio-auth-story-title">A clearer view.<br /><em>A better place to build.</em></h2><p>Bring your architecture, infrastructure code, and cloud insights into one connected workspace.</p></div>
    <div className="studio-auth-diagram" aria-hidden="true">
      <div className="studio-auth-diagram-heading"><Workflow size={15} /><span>From idea to infrastructure</span><span className="studio-auth-diagram-dots">···</span></div>
      <div className="studio-auth-topology"><svg viewBox="0 0 400 240" preserveAspectRatio="none"><path d="M200 55 V105 M200 105 H80 V165 M200 105 H320 V165" /></svg><div className="studio-auth-node studio-auth-node--gateway"><Globe size={20} /><div><strong>API Gateway</strong><span>Your entry point</span></div></div><div className="studio-auth-node studio-auth-node--function"><Zap size={20} /><div><strong>Lambda</strong><span>Application logic</span></div></div><div className="studio-auth-node studio-auth-node--data"><Database size={20} /><div><strong>DynamoDB</strong><span>Application data</span></div></div><span className="studio-auth-topology-dot" /></div>
      <div className="studio-auth-diagram-footer"><Code2 size={15} /><span>Designed visually. Defined in Terraform.</span></div>
    </div>
    <div className="studio-auth-story-footer"><LockKeyhole size={17} /><p>Your workspace. Your AWS account.<br /><span>Access stays scoped to your role.</span></p></div>
  </section>;
}

// The backend sends only a code in ?oauth_error= (never text), so this page alone decides the
// wording — a crafted link can't make the login page display a message of someone else's choosing.
function oauthErrorMessage(code: string) {
  switch (code) {
    case 'cancelled':
      return 'Sign-in was cancelled.';
    case 'state_invalid':
      return 'This sign-in attempt expired or was started in a different browser. Please try again.';
    case 'email_unverified':
      return 'Your account with that provider has no verified email address. Verify one there, then try again.';
    case 'account_inactive':
      return 'This account is not active. Contact your workspace administrator.';
    case 'not_enabled':
      return 'That sign-in method is not available right now.';
    case 'provider_error':
      return 'We couldn’t complete sign-in with the provider. Please try again in a moment.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

// Google's multi-colour "G" — its brand guidelines ask for the original mark on sign-in buttons.
function GoogleMark() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 48 48" width="18">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

function getAuthRedirectTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : DASHBOARD_ROUTE;
}

function validateAuthForm({
  email,
  hasAcceptedLegal,
  isRegister,
  name,
  password,
}: {
  email: string;
  hasAcceptedLegal: boolean;
  isRegister: boolean;
  name: string;
  password: string;
}) {
  const validationErrors: AuthFieldErrors = {};
  const trimmedEmail = email.trim();

  if (isRegister && name.trim().length < 2) {
    validationErrors.name = 'Enter your full name.';
  }

  if (!trimmedEmail) {
    validationErrors.email = 'Enter your email address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    validationErrors.email = 'Enter a valid email address.';
  }

  if (!password) {
    validationErrors.password = 'Enter your password.';
  } else if (password.length < 8) {
    validationErrors.password = 'Password must be at least 8 characters.';
  }

  if (isRegister && !hasAcceptedLegal) {
    validationErrors.legal = 'Accept the terms and privacy policy to continue.';
  }

  return validationErrors;
}

export default AuthPage;
