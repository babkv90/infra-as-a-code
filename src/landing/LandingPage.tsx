import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  CloudCog,
  Copy,
  ExternalLink,
  Github,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Play,
  Rocket,
  Sparkles,
  Sun,
  TerminalSquare,
} from 'lucide-react';
import type React from 'react';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import {
  APP_NAME,
  DASHBOARD_ROUTE,
  LOGIN_ROUTE,
  REGISTER_ROUTE,
  aiBullets,
  awsMetrics,
  builderServices,
  chartLabels,
  floatingBadges,
  footerColumns,
  heroDiagramEdges,
  heroDiagramNodes,
  heroStats,
  howItWorks,
  navItems,
  pricingPlans,
  problemCards,
  securityItems,
  solutionCards,
  terraformPreview,
  trustSignals,
  useCases,
  type DiagramNode,
  type IconItem,
} from './landingConfig';

function LandingPage({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  return (
    <div className="landing-page">
      <Navbar theme={theme} onToggleTheme={onToggleTheme} />
      <main>
        <HeroSection />
        <TrustBar />
        <ProblemSection />
        <SolutionSection />
        <BuilderSection />
        <AgentSection />
        <TerraformSection />
        <InsightsSection />
        <UseCasesSection />
        <SecuritySection />
        <HowItWorksSection />
        <PricingSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

function Navbar({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  return (
    <header className="lp-nav">
      <a className="lp-logo" href="/">
        <span className="lp-logo-mark">
          <CloudCog size={20} />
        </span>
        <span>{APP_NAME}</span>
      </a>
      <nav className="lp-nav-links">
        {navItems.map((item) => (
          <a href={`#${slug(item)}`} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <div className="lp-nav-actions">
        <button className="lp-theme-toggle" onClick={onToggleTheme} title={getThemeToggleTitle(theme)}>
          {theme === 'dark' ? <Sun size={16} /> : theme === 'light' ? <Sparkles size={16} /> : <Moon size={16} />}
        </button>
        <a className="lp-link-button" href={LOGIN_ROUTE}>
          Login
        </a>
        <a className="lp-secondary-button lp-secondary-button--small" href={REGISTER_ROUTE}>
          Register
        </a>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="lp-hero section-reveal" id="product">
      <div className="lp-hero-glow lp-hero-glow--cyan" />
      <div className="lp-hero-glow lp-hero-glow--violet" />
      <div className="lp-hero-content">
        <div className="lp-kicker">
          <Sparkles size={16} />
          AI-powered visual IaaS automation
        </div>
        <h1>Build AWS Infrastructure Visually. Deploy with Confidence.</h1>
        <p>
          Design Lambda, API Gateway, S3, DynamoDB, VPC, and more using an n8n-style infrastructure canvas. Generate
          Terraform code, connect your AWS account, and let an AI agent monitor cost, usage, and resources in real time.
        </p>
        <div className="lp-hero-actions">
          <a className="lp-primary-button" href={REGISTER_ROUTE}>
            Start Building
            <ArrowRight size={18} />
          </a>
          <a className="lp-secondary-button" href="#visual-builder">
            <Play size={17} />
            View Live Demo
          </a>
          <a className="lp-inline-link" href="#terraform-export">
            Export Terraform in seconds
            <ChevronRight size={16} />
          </a>
        </div>
        <div className="lp-hero-stats">
          {heroStats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-hero-visual">
        <DiagramMockup variant="hero" />
        <div className="lp-badge-row">
          {floatingBadges.map((badge) => (
            <span className="lp-floating-badge" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="lp-trust section-reveal">
      {trustSignals.map((signal) => {
        const Icon = signal.icon;
        return (
          <div key={signal.label}>
            <Icon size={17} />
            <span>{signal.label}</span>
          </div>
        );
      })}
    </section>
  );
}

function ProblemSection() {
  return (
    <Section id="product-pain" eyebrow="Problem" title="Cloud infrastructure is powerful, but still too complex.">
      <div className="lp-card-grid lp-card-grid--4">
        {problemCards.map((card) => (
          <InfoCard key={card.title} {...card} />
        ))}
      </div>
    </Section>
  );
}

function SolutionSection() {
  return (
    <Section id="ai-agent" eyebrow="Solution" title="One visual canvas for designing, generating, and managing AWS infrastructure.">
      <div className="lp-card-grid lp-card-grid--3">
        {solutionCards.map((card) => (
          <InfoCard key={card.title} {...card} large />
        ))}
      </div>
    </Section>
  );
}

function BuilderSection() {
  return (
    <Section id="visual-builder" eyebrow="Visual Builder" title="An n8n-style builder for cloud infrastructure.">
      <div className="lp-builder-mockup">
        <aside className="lp-builder-sidebar">
          <div className="lp-builder-title">AWS Services</div>
          {builderServices.map((service) => (
            <div className="lp-builder-service" key={service}>
              <span />
              {service}
            </div>
          ))}
        </aside>
        <div className="lp-builder-canvas">
          <DiagramMockup variant="builder" />
          <div className="lp-builder-status">
            <span>
              <Check size={14} />
              Validation passed
            </span>
            <span>
              <TerminalSquare size={14} />
              Terraform generated
            </span>
            <span>
              <Rocket size={14} />
              Ready to deploy
            </span>
          </div>
        </div>
        <aside className="lp-builder-props">
          <div className="lp-builder-title">Selected Node</div>
          <div className="lp-prop-heading">AWS Lambda</div>
          {[
            ['Function Name', 'process-user-order'],
            ['Runtime', '.NET 8'],
            ['Memory', '512 MB'],
            ['Timeout', '30 seconds'],
            ['Trigger', 'API Gateway'],
          ].map(([label, value]) => (
            <label className="lp-prop-field" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </label>
          ))}
          <div className="lp-prop-stack">
            <span>Environment Variables</span>
            <span>IAM Permissions</span>
            <span>Terraform Preview</span>
          </div>
        </aside>
      </div>
    </Section>
  );
}

function AgentSection() {
  return (
    <section className="lp-split-section section-reveal">
      <div>
        <div className="lp-section-eyebrow">AI Agent</div>
        <h2>Connect your AWS account to an AI cloud engineer.</h2>
        <p>
          The AI agent helps users understand their AWS account in simple language, from billing changes to failing
          Lambda functions, idle resources, IAM risks, and architecture optimization.
        </p>
        <div className="lp-bullet-grid">
          {aiBullets.map((item) => (
            <span key={item}>
              <Check size={14} />
              {item}
            </span>
          ))}
        </div>
        <div className="lp-section-actions">
          <a className="lp-primary-button" href={DASHBOARD_ROUTE}>
            Connect AWS Account
            <ExternalLink size={17} />
          </a>
          <a className="lp-secondary-button" href={DASHBOARD_ROUTE}>
            Go to Dashboard
            <LayoutDashboard size={17} />
          </a>
        </div>
      </div>
      <AIChatMockup />
    </section>
  );
}

function TerraformSection() {
  return (
    <section className="lp-split-section lp-split-section--code section-reveal" id="terraform-export">
      <div className="lp-mini-diagram-card">
        <div className="lp-section-eyebrow">Terraform Export</div>
        <h2>From diagram to Terraform code.</h2>
        <p>Turn architecture diagrams into reviewable infrastructure code that your team can copy, export, push, or deploy.</p>
        <DiagramMockup variant="mini" />
      </div>
      <div className="lp-code-card">
        <div className="lp-code-header">
          <span>main.tf</span>
          <span>Generated Preview</span>
        </div>
        <pre>{terraformPreview}</pre>
        <div className="lp-code-actions">
          <button>Export Terraform</button>
          <button>
            <Copy size={14} />
            Copy Code
          </button>
          <button>
            <Github size={14} />
            Push to GitHub
          </button>
          <button>
            <Rocket size={14} />
            Deploy to AWS
          </button>
        </div>
      </div>
    </section>
  );
}

function InsightsSection() {
  return (
    <Section id="aws-insights" eyebrow="AWS Insights" title="Know what is running in your AWS account.">
      <div className="lp-metric-grid">
        {awsMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div className={`lp-metric-card lp-tone-${metric.tone}`} key={metric.label}>
              <Icon size={18} />
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          );
        })}
      </div>
      <div className="lp-chart-grid">
        {chartLabels.map((label, index) => (
          <div className="lp-chart-card" key={label}>
            <span>{label}</span>
            <div className={`lp-chart-bars lp-chart-bars--${index + 1}`}>
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UseCasesSection() {
  return (
    <Section id="use-cases" eyebrow="Use Cases" title="Built for modern cloud teams.">
      <div className="lp-usecase-grid">
        {useCases.map((item) => (
          <div className="lp-usecase-card" key={item}>
            <Check size={16} />
            {item}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SecuritySection() {
  return (
    <section className="lp-security section-reveal">
      <div>
        <div className="lp-section-eyebrow">Security</div>
        <h2>Secure by design.</h2>
        <p>
          Built around role-based access, least-privilege guidance, encrypted secrets, review gates, and auditability
          before infrastructure changes reach AWS.
        </p>
      </div>
      <div className="lp-security-grid">
        {securityItems.map((item) => (
          <div key={item}>
            <LockKeyhole size={15} />
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <Section id="docs" eyebrow="How it works" title="Design, validate, generate, and monitor.">
      <div className="lp-steps">
        {howItWorks.map((step, index) => {
          const Icon = step.icon;
          return (
            <div className="lp-step-card" key={step.title}>
              <span className="lp-step-number">0{index + 1}</span>
              <Icon size={24} />
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PricingSection() {
  return (
    <Section id="pricing" eyebrow="Pricing" title="Start visually. Scale into connected AWS operations.">
      <div className="lp-pricing-grid">
        {pricingPlans.map((plan) => (
          <div className={`lp-pricing-card ${plan.featured ? 'lp-pricing-card--featured' : ''}`} key={plan.name}>
            <div>
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
            </div>
            <div className="lp-price">
              {plan.price}
              {plan.price.startsWith('$') && <span>/mo</span>}
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={14} />
                  {feature}
                </li>
              ))}
            </ul>
            <a className={plan.featured ? 'lp-primary-button' : 'lp-secondary-button'} href={DASHBOARD_ROUTE}>
              {plan.cta}
            </a>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FinalCTA() {
  return (
    <section className="lp-final-cta section-reveal">
      <div className="lp-final-glow" />
      <h2>Ready to build your AWS infrastructure visually?</h2>
      <p>
        Start with a diagram, generate Terraform, connect your AWS account, and let AI help you manage cloud cost,
        resources, and reliability.
      </p>
      <div className="lp-hero-actions">
        <a className="lp-secondary-button" href={DASHBOARD_ROUTE}>
          Start Building Now
          <ArrowRight size={17} />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-brand">
        <a className="lp-logo" href="/">
          <span className="lp-logo-mark">
            <CloudCog size={20} />
          </span>
          <span>{APP_NAME}</span>
        </a>
        <p>Design, generate, and deploy AWS infrastructure visually with AI.</p>
      </div>
      {Object.entries(footerColumns).map(([title, links]) => (
        <div className="lp-footer-column" key={title}>
          <h4>{title}</h4>
          {links.map((link) => (
            <a href="/" key={link}>
              {link}
            </a>
          ))}
        </div>
      ))}
    </footer>
  );
}

function DiagramMockup({ variant }: { variant: 'hero' | 'builder' | 'mini' }) {
  const nodes = variant === 'mini' ? heroDiagramNodes.slice(0, 5) : heroDiagramNodes;
  const edges = variant === 'mini' ? heroDiagramEdges.slice(0, 4) : heroDiagramEdges;

  return (
    <div className={`lp-diagram lp-diagram--${variant}`}>
      <svg className="lp-diagram-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map((edge) => {
          const source = nodes.find((node) => node.id === edge.from);
          const target = nodes.find((node) => node.id === edge.to);
          if (!source || !target) return null;
          return <ConnectionLine key={`${edge.from}-${edge.to}`} source={source} target={target} bend={edge.bend ?? 0} />;
        })}
      </svg>
      {nodes.map((node, index) => {
        const Icon = node.icon;
        return (
          <div
            className="lp-diagram-node"
            style={{ left: `${node.x}%`, top: `${node.y}%`, borderColor: node.color, animationDelay: `${index * 120}ms` }}
            key={node.id}
          >
            <span className="lp-connector lp-connector--left" />
            <span className="lp-connector lp-connector--right" />
            <Icon size={20} style={{ color: node.color }} />
            <div>
              <strong>{node.label}</strong>
              <small>{node.status}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectionLine({ source, target, bend }: { source: DiagramNode; target: DiagramNode; bend: number }) {
  const x1 = source.x + 10;
  const y1 = source.y;
  const x2 = target.x - 10;
  const y2 = target.y;
  const mid = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${mid} ${y1 + bend}, ${mid} ${y2 - bend}, ${x2} ${y2}`;
  return <path d={path} />;
}

function AIChatMockup() {
  return (
    <div className="lp-chat-card">
      <div className="lp-chat-header">
        <span>
          <Sparkles size={16} />
          AI Cloud Agent
        </span>
        <strong>Live AWS context</strong>
      </div>
      <ChatBubble role="user">Why did my AWS bill increase this week?</ChatBubble>
      <ChatBubble role="agent">Connect an AWS account to load real billing, resource, and CloudWatch signals.</ChatBubble>
      <ChatBubble role="user">Can you optimize my serverless architecture?</ChatBubble>
      <ChatBubble role="agent">No live architecture data is available yet. Start by building a diagram or syncing AWS.</ChatBubble>
    </div>
  );
}

function ChatBubble({ role, children }: { role: 'user' | 'agent'; children: string }) {
  return <div className={`lp-chat-bubble lp-chat-bubble--${role}`}>{children}</div>;
}

function InfoCard({ title, description, icon: Icon, large }: IconItem & { large?: boolean }) {
  return (
    <article className={`lp-info-card ${large ? 'lp-info-card--large' : ''}`}>
      <span className="lp-info-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="lp-section section-reveal" id={id}>
      <div className="lp-section-heading">
        <span className="lp-section-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default LandingPage;
