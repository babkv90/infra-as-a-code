import { APP_NAME } from '../landing/landingConfig';
import { Layers } from 'lucide-react';
import { useUiExperience } from '../ui/UiExperience';

type AppLogoProps = {
  className?: string;
  suffix?: string;
};

function AppLogo({ className = '', suffix }: AppLogoProps) {
  const { experience } = useUiExperience();
  if (experience !== 'classic') {
    return <span className={`app-logo studio-logo ${className}`.trim()} aria-label="CodeManus"><span className="studio-logo__mark" aria-hidden="true"><Layers size={23} /></span><span className="studio-logo__word">CodeManus<span>.</span></span>{suffix && <span className="app-logo__suffix">{suffix}</span>}</span>;
  }
  return (
    <span className={`app-logo ${className}`.trim()}>
      <img className="app-logo__image app-logo__image--default" src="/infraflow.png" alt={APP_NAME} />
      <img className="app-logo__image app-logo__image--dark" src="/infraflow-dark.png" alt="" aria-hidden="true" />
      {suffix && <span className="app-logo__suffix">{suffix}</span>}
    </span>
  );
}

export default AppLogo;
