import { ArrowLeft, ArrowRight, CloudCog, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { DASHBOARD_ROUTE, LOGIN_ROUTE, REGISTER_ROUTE } from '../landing/landingConfig';
import { getThemeToggleLabel, type ThemeMode } from '../theme';
import { forgotPassword, login, register } from './authClient';

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
  const [isRequestingReset, setIsRequestingReset] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = isRegister ? 'Create your InfraPilot account' : 'Login to InfraPilot AI';
  const description = isRegister
    ? 'Register your workspace and start designing AWS infrastructure visually.'
    : 'Access your diagrams, Terraform exports, AWS insights, and AI cloud agent.';

  const canSubmit = useMemo(() => {
    if (!email.trim() || password.length < 8) return false;
    if (isRegister && name.trim().length < 2) return false;
    return true;
  }, [email, isRegister, name, password]);

  const canRequestPasswordReset = !isRegister && email.trim().length > 0 && !isRequestingReset;

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

      window.location.href = DASHBOARD_ROUTE;
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
      setForgotPasswordToken(result.data?.resetToken ?? '');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not request password reset. Please try again.');
    } finally {
      setIsRequestingReset(false);
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
          <span className="auth-logo-mark">
            <CloudCog size={22} />
          </span>
          <span>InfraPilot AI</span>
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
                }}
                type="button"
              >
                Forgot password?
              </button>

              {showForgotPassword && (
                <div className="auth-forgot-panel">
                  <p>Enter your email above and request a reset token.</p>
                  <button className="auth-secondary-submit" disabled={!canRequestPasswordReset} onClick={handleForgotPassword} type="button">
                    {isRequestingReset ? 'Sending...' : 'Send reset link'}
                    <Mail size={16} />
                  </button>
                  {forgotPasswordMessage && <div className="auth-success">{forgotPasswordMessage}</div>}
                  {forgotPasswordToken && (
                    <div className="auth-reset-token">
                      <span>Development reset token</span>
                      <code>{forgotPasswordToken}</code>
                    </div>
                  )}
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
          {isRegister ? 'Already have an account?' : 'New to InfraPilot AI?'}
          <a href={isRegister ? LOGIN_ROUTE : REGISTER_ROUTE}>{isRegister ? ' Login' : ' Create account'}</a>
        </p>
      </section>
    </main>
  );
}

export default AuthPage;
