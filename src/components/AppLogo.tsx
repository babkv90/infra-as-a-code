import { APP_NAME } from '../landing/landingConfig';

type AppLogoProps = {
  className?: string;
  suffix?: string;
};

function AppLogo({ className = '', suffix }: AppLogoProps) {
  return (
    <span className={`app-logo ${className}`.trim()}>
      <img className="app-logo__image app-logo__image--default" src="/infraflow.png" alt={APP_NAME} />
      <img className="app-logo__image app-logo__image--dark" src="/infraflow-dark.png" alt="" aria-hidden="true" />
      {suffix && <span className="app-logo__suffix">{suffix}</span>}
    </span>
  );
}

export default AppLogo;
