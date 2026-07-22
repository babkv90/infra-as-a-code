import { ArrowLeft, ArrowRight, CloudCog, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import AppLogo from '../components/AppLogo';
import { DASHBOARD_ROUTE, LOGIN_ROUTE, REGISTER_ROUTE } from '../landing/landingConfig';
import { getThemeToggleLabel, type ThemeMode } from '../theme';
import { forgotPassword, login, register, resetPassword } from './authClient';

type AuthMode = 'login' | 'register';

function AuthPage({ mode, theme, onToggleTheme }: { mode: AuthMode; theme: ThemeMode; onToggleTheme: () => void }) {
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = isRegister ? 'Create your infraflow account' : 'Login to infraflow';
  const description = isRegister
    ? 'Register your workspace and start designing AWS infrastructure visually.'
    : 'Access your diagrams, Terraform exports, AWS insights, and AI cloud agent.';

  const canSubmit = useMemo(() => {
    if (!email.trim() || password.length < 8) return false;
    if (isRegister && name.trim().length < 2) return false;
    return true;
  }, [email, isRegister, name, password]);

  const canRequestPasswordReset = !isRegister && email.trim().length > 0 && !isRequestingReset;
  const canResetPassword = !isRegister && resetToken.trim().length >= 32 && resetNewPassword.length >= 8 && !isResettingPassword;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;

    setError('');
    setIsSubmitting(true);

    try {
      if (isRegister) {
        await register({
          name: name.trim(),
          workspaceName: workspaceName.trim() || undefined,
          email: email.trim(),
          password,
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
      <section className="auth-panel">
        <a className="auth-back-link" href="/">
          <ArrowLeft size={16} />
          Back to home
        </a>
        <div className="auth-brand">
          <AppLogo className="app-logo--auth" />
        </div>
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
      </section>

      <section className="auth-card">
        <div className="auth-card-header">
          <div>
            <span className="auth-eyebrow">{isRegister ? 'Register' : 'Login'}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="auth-theme-button" onClick={onToggleTheme} type="button">
            {getThemeToggleLabel(theme)}
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <label className="auth-field">
                <span>Full name</span>
                <div>
                  <UserRound size={17} />
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" />
                </div>
              </label>
              <label className="auth-field">
                <span>Workspace name</span>
                <div>
                  <CloudCog size={17} />
                  <input
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
            <span>Email address</span>
            <div>
              <Mail size={17} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" type="email" />
            </div>
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div>
              <LockKeyhole size={17} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                type={showPassword ? 'text' : 'password'}
              />
              <button className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {!isRegister && (
            <div className="auth-forgot">
              <button
                className="auth-link-button"
                onClick={() => {
                  setShowForgotPassword((value) => !value);
                  setForgotPasswordMessage('');
                  setForgotPasswordToken('');
                  setResetToken('');
                  setResetNewPassword('');
                }}
                type="button"
              >
                Reset password
              </button>

              {showForgotPassword && (
                <div className="auth-forgot-panel">
                  <p>Enter your email above, request a reset token, then set a new password.</p>
                  <button className="auth-secondary-submit" disabled={!canRequestPasswordReset} onClick={handleForgotPassword} type="button">
                    {isRequestingReset ? 'Sending...' : 'Get reset token'}
                    <Mail size={16} />
                  </button>
                  {forgotPasswordMessage && <div className="auth-success">{forgotPasswordMessage}</div>}
                  {forgotPasswordToken && (
                    <div className="auth-reset-token">
                      <span>Development reset token</span>
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

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" disabled={!canSubmit || isSubmitting} type="submit">
            {isSubmitting ? 'Please wait...' : isRegister ? 'Create account' : 'Login'}
            <ArrowRight size={17} />
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : 'New to infraflow?'}
          <a href={isRegister ? LOGIN_ROUTE : REGISTER_ROUTE}>{isRegister ? ' Login' : ' Create account'}</a>
        </p>
      </section>
    </main>
  );
}

function getAuthRedirectTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : DASHBOARD_ROUTE;
}

export default AuthPage;
