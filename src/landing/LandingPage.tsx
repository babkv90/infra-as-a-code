import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Github,
  LockKeyhole,
  Moon,
  Play,
  Rocket,
  Sparkles,
  Sun,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type React from 'react';
import AppLogo from '../components/AppLogo';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import {
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
  // pricingPlans,
  problemCards,
  securityItems,
  solutionCards,
  terraformPreview,
  trustSignals,
  useCases,
  type DiagramNode,
  type IconItem,
} from './landingConfig';

type LearningDetail = {
  title: string;
  subtitle: string;
  process: string;
  example: string;
  steps: string[];
};

const miniDiagramPositions: Record<string, { x: number; y: number; status?: string }> = {
  api: { x: 19, y: 30, status: 'Public API' },
  events: { x: 19, y: 68, status: 'Scheduler' },
  lambda: { x: 50, y: 49, status: 'Runtime' },
  ddb: { x: 81, y: 30, status: 'NoSQL' },
  s3: { x: 81, y: 68, status: 'Object store' },
};

const miniDiagramEdges = [
  { from: 'api', to: 'lambda', bend: 3 },
  { from: 'events', to: 'lambda', bend: -3 },
  { from: 'lambda', to: 'ddb', bend: -3 },
  { from: 'lambda', to: 's3', bend: 3 },
];

const diagramBounds = {
  xMin: 12,
  xMax: 88,
  yMin: 14,
  yMax: 86,
};

function LandingPage({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [detail, setDetail] = useState<LearningDetail | null>(null);

  return (
    <div className="landing-page">
      <Navbar theme={theme} onToggleTheme={onToggleTheme} />
      <main>
        <HeroSection />
        <TrustBar />
        <ProblemSection onOpenDetail={setDetail} />
        <SolutionSection onOpenDetail={setDetail} />
        <BuilderSection />
        <AgentSection />
        <TerraformSection />
        <InsightsSection onOpenDetail={setDetail} />
        <UseCasesSection onOpenDetail={setDetail} />
        <SecuritySection onOpenDetail={setDetail} />
        <HowItWorksSection onOpenDetail={setDetail} />
        {/* <PricingSection /> */}
        <FinalCTA />
      </main>
      <Footer />
      {detail && <LearningDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Navbar({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  return (
    <header className="lp-nav">
      <a className="lp-logo" href="/">
        <AppLogo className="app-logo--nav" />
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
        {/* <a className="lp-reference-nav-button" href={REFERENCE_DOCS_ROUTE}>
          <FileText size={15} />
          Lab Reference
        </a> */}
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

function ProblemSection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <Section id="product-pain" eyebrow="Problem" title="Cloud infrastructure is powerful, but still too complex.">
      <div className="lp-card-grid lp-card-grid--4">
        {problemCards.map((card) => (
          <InfoCard detail={getLandingInfoDetail('problem', card.title, card.description)} key={card.title} onOpenDetail={onOpenDetail} {...card} />
        ))}
      </div>
    </Section>
  );
}

function SolutionSection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <Section id="ai-agent" eyebrow="Solution" title="One visual canvas for designing, generating, and managing AWS infrastructure.">
      <div className="lp-card-grid lp-card-grid--3">
        {solutionCards.map((card) => (
          <InfoCard detail={getLandingInfoDetail('solution', card.title, card.description)} key={card.title} onOpenDetail={onOpenDetail} {...card} large />
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

function InsightsSection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <Section id="aws-insights" eyebrow="AWS Insights" title="Know what is running in your AWS account.">
      <div className="lp-metric-grid">
        {awsMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <button className={`lp-metric-card lp-tone-${metric.tone}`} key={metric.label} onClick={() => onOpenDetail(getLandingMetricDetail(metric.label, metric.value))} type="button">
              <Icon size={18} />
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </button>
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

function UseCasesSection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <Section id="use-cases" eyebrow="Use Cases" title="Built for modern cloud teams.">
      <div className="lp-usecase-grid">
        {useCases.map((item) => (
          <button className="lp-usecase-card" key={item} onClick={() => onOpenDetail(getLandingUseCaseDetail(item))} type="button">
            <Check size={16} />
            {item}
          </button>
        ))}
      </div>
    </Section>
  );
}

function SecuritySection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
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
          <button className="lp-security-item" key={item} onClick={() => onOpenDetail(getLandingSecurityDetail(item))} type="button">
            <LockKeyhole size={15} />
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function HowItWorksSection({ onOpenDetail }: { onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <Section id="docs" eyebrow="How it works" title="Design, validate, generate, and monitor.">
      <div className="lp-steps">
        {howItWorks.map((step, index) => {
          const Icon = step.icon;
          return (
            <button className="lp-step-card" key={step.title} onClick={() => onOpenDetail(getLandingStepDetail(step.title, step.description, index + 1))} type="button">
              <span className="lp-step-number">0{index + 1}</span>
              <Icon size={24} />
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// function PricingSection() {
//   return (
//     <Section id="pricing" eyebrow="Pricing" title="Start visually. Scale into connected AWS operations.">
//       <div className="lp-pricing-grid">
//         {pricingPlans.map((plan) => (
//           <div className={`lp-pricing-card ${plan.featured ? 'lp-pricing-card--featured' : ''}`} key={plan.name}>
//             <div>
//               <h3>{plan.name}</h3>
//               <p>{plan.description}</p>
//             </div>
//             <div className="lp-price">
//               {plan.price}
//               {plan.price.startsWith('$') && <span>/mo</span>}
//             </div>
//             <ul>
//               {plan.features.map((feature) => (
//                 <li key={feature}>
//                   <Check size={14} />
//                   {feature}
//                 </li>
//               ))}
//             </ul>
//             <a className={plan.featured ? 'lp-primary-button' : 'lp-secondary-button'} href={DASHBOARD_ROUTE}>
//               {plan.cta}
//             </a>
//           </div>
//         ))}
//       </div>
//     </Section>
//   );
// }

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
          <AppLogo className="app-logo--footer" />
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
  const diagramRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState(() =>
    variant === 'mini'
      ? heroDiagramNodes.slice(0, 5).map((node) => ({
          ...node,
          ...miniDiagramPositions[node.id],
        }))
      : heroDiagramNodes,
  );
  const edges = variant === 'mini' ? miniDiagramEdges : heroDiagramEdges;

  function pointerToDiagramPosition(event: React.PointerEvent) {
    const rect = diagramRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function moveNode(nodeId: string, x: number, y: number) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              x: clamp(x, diagramBounds.xMin, diagramBounds.xMax),
              y: clamp(y, diagramBounds.yMin, diagramBounds.yMax),
            }
          : node,
      ),
    );
  }

  function handleNodePointerDown(event: React.PointerEvent<HTMLDivElement>, node: DiagramNode) {
    const pointer = pointerToDiagramPosition(event);
    if (!pointer) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      offsetX: node.x - pointer.x,
      offsetY: node.y - pointer.y,
    };
    setActiveNodeId(node.id);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const pointer = pointerToDiagramPosition(event);
    if (!pointer) return;

    moveNode(dragRef.current.id, pointer.x + dragRef.current.offsetX, pointer.y + dragRef.current.offsetY);
  }

  function stopDragging() {
    dragRef.current = null;
    setActiveNodeId(null);
  }

  function handleNodeKeyDown(event: React.KeyboardEvent<HTMLDivElement>, node: DiagramNode) {
    const step = event.shiftKey ? 4 : 2;
    const movement = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    }[event.key];

    if (!movement) return;
    event.preventDefault();
    moveNode(node.id, node.x + movement[0], node.y + movement[1]);
  }

  return (
    <div className={`lp-diagram lp-diagram--${variant}`} onPointerCancel={stopDragging} onPointerMove={handlePointerMove} onPointerUp={stopDragging} ref={diagramRef}>
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
            aria-label={`Drag ${node.label} node`}
            className={`lp-diagram-node ${activeNodeId === node.id ? 'lp-diagram-node--active' : ''}`}
            onKeyDown={(event) => handleNodeKeyDown(event, node)}
            onPointerDown={(event) => handleNodePointerDown(event, node)}
            role="button"
            style={{ left: `${node.x}%`, top: `${node.y}%`, borderColor: node.color, animationDelay: `${index * 120}ms` }}
            tabIndex={0}
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function InfoCard({
  title,
  description,
  icon: Icon,
  large,
  detail,
  onOpenDetail,
}: IconItem & { large?: boolean; detail: LearningDetail; onOpenDetail: (detail: LearningDetail) => void }) {
  return (
    <button className={`lp-info-card ${large ? 'lp-info-card--large' : ''}`} onClick={() => onOpenDetail(detail)} type="button">
      <span className="lp-info-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </button>
  );
}

function LearningDetailModal({ detail, onClose }: { detail: LearningDetail; onClose: () => void }) {
  return (
    <div className="runtime-lab-detail-backdrop" role="presentation" onClick={onClose}>
      <section className="runtime-lab-detail-modal" role="dialog" aria-modal="true" aria-labelledby="learning-detail-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{detail.subtitle}</span>
            <h3 id="learning-detail-title">{detail.title}</h3>
          </div>
          <button aria-label="Close detail explanation" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="runtime-lab-detail-body">
          <section>
            <h4>Process</h4>
            <p>{detail.process}</p>
          </section>
          <section>
            <h4>Real application example</h4>
            <p>{detail.example}</p>
          </section>
          <section>
            <h4>How it works in this application</h4>
            <ol>
              {detail.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        </div>
      </section>
    </div>
  );
}

function getLandingInfoDetail(kind: 'problem' | 'solution', title: string, description: string): LearningDetail {
  const isProblem = kind === 'problem';
  return {
    title,
    subtitle: isProblem ? 'Cloud operations problem' : 'Application workflow',
    process: `${description} The process starts when a user designs or syncs infrastructure, then the app normalizes that information into resources, relationships, Terraform output, cost signals, and security checks.`,
    example: isProblem
      ? `Real example: a user creates S3, Lambda, API Gateway, and IAM manually in AWS. A missing permission or public access setting is easy to miss. In this app, the same architecture can be represented visually, validated, exported, and explained before deployment.`
      : `Real example: a DevOps user opens the dashboard, builds an AWS diagram, exports Terraform, connects an AWS account, and uses the AI agent to understand cost, security, and deployment impact from the same workspace.`,
    steps: [
      'User opens the visual workflow from the landing page or dashboard.',
      'React renders the cards, builder, and dashboard panels for the selected workflow.',
      'The backend stores diagrams, reads AWS metadata, and prepares Terraform or insight payloads.',
      'The UI presents a compact card first, then this popup explains the full process and real use case.',
    ],
  };
}

function getLandingMetricDetail(label: string, value: string): LearningDetail {
  return {
    title: label,
    subtitle: `Current value: ${value}`,
    process:
      'Metric cards summarize operational signals from AWS or the local application state. In production, these values should come from Cost Explorer, CloudWatch, AWS inventory APIs, and saved diagram metadata.',
    example:
      'Real example: after connecting AWS, a DevOps user can see monthly spend, failed Lambda invocations, idle resources, and security warnings without opening multiple AWS console screens.',
    steps: [
      'The user connects an AWS account with an IAM role.',
      'The backend syncs inventory, billing, logs, and security signals.',
      'The dashboard API returns normalized metrics to React.',
      'Each card shows the short value, while this popup explains what the metric means operationally.',
    ],
  };
}

function getLandingUseCaseDetail(item: string): LearningDetail {
  return {
    title: item,
    subtitle: 'Real-world usage pattern',
    process:
      'A use case describes who uses the platform and what workflow they complete. The same React, Node, and Mongo stack supports design, storage, collaboration, AWS sync, and AI-assisted explanations.',
    example: `Real example: ${item} starts with a user creating or importing architecture, validating it, generating Terraform, and then tracking AWS cost or risk from the dashboard.`,
    steps: [
      'Capture the infrastructure intent as a diagram or imported Terraform.',
      'Persist the normalized design in MongoDB through the Node API.',
      'Generate operational views such as cost, deployment, and security panels.',
      'Use the AI agent and dashboard cards to explain what should be changed next.',
    ],
  };
}

function getLandingSecurityDetail(item: string): LearningDetail {
  return {
    title: item,
    subtitle: 'Security control',
    process:
      'Security controls reduce deployment risk before infrastructure reaches AWS. The app should validate IAM scope, public exposure, secrets, and auditability as part of the design and deployment workflow.',
    example: `Real example: ${item} helps a platform team let users inspect AWS resources and generate Terraform without exposing permanent AWS keys or allowing broad unsafe changes.`,
    steps: [
      'User connects AWS through a controlled role or creates a diagram locally.',
      'The backend validates permissions and stores only the metadata required by the app.',
      'Security checks are shown in dashboard cards and deployment gates.',
      'The popup explains why the control matters before the user applies changes.',
    ],
  };
}

function getLandingStepDetail(title: string, description: string, order: number): LearningDetail {
  return {
    title,
    subtitle: `Workflow step ${order}`,
    process: `${description} This is one stage in the end-to-end platform workflow from architecture design to AWS-aware operations.`,
    example:
      'Real example: a user designs a Lambda API flow, validates missing IAM and networking links, exports Terraform, then monitors the deployed services and cost from the dashboard.',
    steps: [
      'React captures the user action in the landing page or dashboard.',
      'The builder, API, or AWS sync service processes the request.',
      'MongoDB stores durable app state such as diagrams, users, and account connections.',
      'The next dashboard card summarizes the result and offers a detailed explanation popup.',
    ],
  };
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
