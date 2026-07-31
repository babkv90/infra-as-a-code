import { Info } from 'lucide-react';

export default function GithubConsentInfo() {
  return (
    <span className="github-consent-info">
      <button className="github-consent-info__trigger" type="button" aria-label="GitHub authorization details">
        <Info size={15} />
      </button>
      <span className="github-consent-info__card" role="tooltip">
        <strong>GitHub authorization</strong>
        <span>
          By connecting GitHub, you authorize infraflow to sync files per our{' '}
          <a href="/legal/terms" rel="noreferrer" target="_blank">
            Terms of Service
          </a>
          .
        </span>
      </span>
    </span>
  );
}
