import { APP_NAME } from '../landing/landingConfig';

type AppLogoProps = {
  className?: string;
  suffix?: string;
};

function AppLogo({ className = '', suffix }: AppLogoProps) {
  return (
    <span className={`app-logo ${className}`.trim()}>
      <img src="/infraflow.png" alt={APP_NAME} />
      {suffix && <span className="app-logo__suffix">{suffix}</span>}
    </span>
  );
}

export default AppLogo;
