import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Cloud, Code2, Database, GitBranch, Layers, LockKeyhole, Search, ShieldCheck, Workflow } from 'lucide-react';
import { awsServices, categories } from '../data/awsServices';
import { REGISTER_ROUTE } from './landingConfig';

export function ProductJourneySection() {
  return <section className="studio-journey section-reveal" id="application-delivery">
    <div className="studio-section-heading"><span className="studio-eyebrow">FROM THE FIRST DIAGRAM TO THE NEXT RELEASE</span><h2>A connected workflow.<br />Room for your way of working.</h2><p>Infrastructure and application delivery belong in the same conversation. Keep their configuration, ownership, and execution visible.</p></div>
    <div className="studio-journey-grid">
      {[
        { icon: Workflow, number: '01', title: 'Design with the whole system in view.', text: 'Start from a template or a blank canvas. Add AWS resources, configure their properties, and inspect the meaning of each connection.', detail: 'Visual builder · Resource configuration · Templates', link: '#visual-builder', cta: 'Explore the builder' },
        { icon: Code2, number: '02', title: 'See the infrastructure you will create.', text: 'Generate Terraform from your architecture. Review configuration and validation results before using the existing deployment workflow.', detail: 'Terraform export · Validation · Deployment history', link: '#terraform-export', cta: 'Understand the workflow' },
        { icon: GitBranch, number: '03', title: 'Give your application a path to AWS.', text: 'Connect GitHub, select your repository and branch, and configure build commands. Generate application pipeline files for the selected deployment target.', detail: 'Repository integration · Build settings · GitHub Actions', link: '/dashboard?view=app-pipeline', cta: 'Open application pipelines' },
      ].map(item => <article key={item.number}><div className="studio-journey-top"><item.icon size={26} /><span>{item.number}</span></div><h3>{item.title}</h3><p>{item.text}</p><small>{item.detail}</small><a href={item.link}>{item.cta}<ArrowRight size={16} /></a></article>)}
    </div>
  </section>;
}

export function ServiceCatalogSection() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const filtered = useMemo(() => awsServices.filter(item => (category === 'All' || category === item.category) && `${item.name} ${item.terraformType}`.toLowerCase().includes(query.toLowerCase())), [query, category]);
  return <section className="studio-catalog section-reveal" id="service-catalog">
    <div className="studio-section-heading"><span className="studio-eyebrow">BUILT AROUND THE AWS SERVICES YOU USE</span><h2>Your architecture, beyond a handful of blocks.</h2><p>Explore the {awsServices.length} resource types in the current builder catalog. Available actions depend on your workspace permissions and service configuration.</p></div>
    <div className="studio-catalog-controls"><label><Search size={17} /><input aria-label="Search the service catalog" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find Lambda, VPC, RDS…" /></label><span>{filtered.length} resource types</span></div>
    <div className="studio-catalog-filters" role="group" aria-label="Filter service categories">{['All', ...categories].map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === 'DB' ? 'Database' : item}</button>)}</div>
    <div className="studio-catalog-grid">{filtered.map(item => <div className="studio-catalog-item" key={item.id}><span style={{ color: item.color }}><Layers size={20} /></span><div><strong>{item.name}</strong><small>{item.terraformType}</small></div><Check size={14} /></div>)}</div>
    {!filtered.length && <p className="studio-catalog-empty" role="status">No services match “{query}”. Try another search or category.</p>}
    <p className="studio-catalog-note">Catalog entries come directly from the builder’s resource definitions. Configuration and connection support vary by resource.</p>
  </section>;
}

export function LiveDataSection() {
  return <section className="studio-live-data section-reveal" id="aws-insights">
    <div className="studio-section-heading"><span className="studio-eyebrow">OBSERVE WHAT IS ACTUALLY THERE</span><h2>Your account tells the story.</h2><p>Connect an AWS role to bring account data into the workspace. Your private metrics stay inside your authenticated dashboard.</p><a className="studio-primary" href="/dashboard?view=connect-aws">Connect your AWS account<ArrowRight size={16} /></a></div>
    <div className="studio-insight-grid">{[
      { icon: Cloud, title: 'Account inventory', text: 'See discovered resources by service, with the latest synchronization time and permission issues.' },
      { icon: Database, title: 'Cost visibility', text: 'Inspect recorded Cost Explorer spend and service breakdowns. Missing data is shown as unavailable.' },
      { icon: GitBranch, title: 'Deployment context', text: 'Follow infrastructure runs, resource details, application pipelines, and their separate execution states.' },
      { icon: ShieldCheck, title: 'Operational signals', text: 'Review available Lambda metrics, CloudTrail events, recommendations, and managed-resource drift checks.' },
    ].map(item => <article key={item.title}><item.icon size={23} /><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
  </section>;
}

export function ProductFaqSection() {
  return <section className="studio-faq section-reveal" id="questions"><div className="studio-section-heading"><span className="studio-eyebrow">A FEW THINGS WORTH KNOWING</span><h2>Clarity before you connect.</h2><p>Understand the workflow before bringing an application into your account.</p></div><div className="studio-faq-list">{[
    ['Where does my infrastructure run?', 'Your infrastructure is deployed into the AWS account you connect. The account, region, and configured IAM permissions remain part of the deployment workflow.'],
    ['Do I need to paste an AWS access key?', 'The account connection uses an IAM role ARN and, when configured, an external ID. The backend assumes that role for supported actions rather than asking you to paste a long-lived AWS access key.'],
    ['Can I inspect the generated Terraform?', 'Yes. The builder generates Terraform from supported resource configurations. You can inspect and export the result and use the existing validation and deployment workflow.'],
    ['Are infrastructure and application deployment the same thing?', 'No. Infrastructure provisioning creates or updates cloud resources. Application pipelines build and release application code to a target. A successful infrastructure run alone does not establish application health.'],
    ['Will every account show all AWS insights?', 'Available insights depend on the connected account, IAM permissions, AWS service availability, and the latest synchronization. The dashboard reports missing permissions and provides connection and synchronization actions.'],
    ['Can I return to the previous interface?', 'Yes. Choose Classic or Architecture Studio from the Design theme selector to return to a previous interface. Your account, saved diagrams, permissions, and deployment data use the same backend in every theme.'],
  ].map(([question, answer]) => <details key={question}><summary>{question}<ChevronRight size={18} /></summary><p>{answer}</p></details>)}</div></section>;
}
