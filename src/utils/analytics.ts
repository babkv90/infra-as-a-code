const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

type GtagCommand = 'config' | 'event' | 'js';
type Gtag = (command: GtagCommand, target: string | Date, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    __infraflowAnalyticsInitialized?: boolean;
  }
}

function getPageViewParams() {
  return {
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    page_title: document.title,
  };
}

function trackPageView() {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('event', 'page_view', getPageViewParams());
}

function installRouteTracking() {
  let lastTrackedUrl = window.location.href;

  const trackIfChanged = () => {
    if (window.location.href === lastTrackedUrl) return;

    lastTrackedUrl = window.location.href;
    trackPageView();
  };

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function pushState(...args) {
    originalPushState.apply(this, args);
    trackIfChanged();
  };

  window.history.replaceState = function replaceState(...args) {
    originalReplaceState.apply(this, args);
    trackIfChanged();
  };

  window.addEventListener('popstate', trackIfChanged);
  window.addEventListener('hashchange', trackIfChanged);
}

export function initializeAnalytics() {
  if (!GA_MEASUREMENT_ID || window.__infraflowAnalyticsInitialized) return;

  window.__infraflowAnalyticsInitialized = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args) {
    window.dataLayer?.push(args);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
  trackPageView();
  installRouteTracking();
}
