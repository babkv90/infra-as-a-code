import privacyPolicyMarkdown from './content/privacy-policy.md?raw';
import termsMarkdown from './content/terms-of-service.md?raw';
import { markdownToHtml } from './markdown';

export type LegalDocKind = 'terms' | 'privacy';

export type LegalDocument = {
  kind: LegalDocKind;
  slug: string;
  version: string;
  effectiveDate: string;
  title: string;
  description: string;
  markdown: string;
  html: string;
};

const currentDocs = {
  terms: parseLegalDocument('terms', 'terms', termsMarkdown),
  privacy: parseLegalDocument('privacy', 'privacy', privacyPolicyMarkdown),
} satisfies Record<LegalDocKind, LegalDocument>;

export const currentLegalVersions = {
  terms: currentDocs.terms.version,
  privacy: currentDocs.privacy.version,
};

export function getCurrentLegalDocument(kind: LegalDocKind) {
  return currentDocs[kind];
}

export function getLegalDocumentByPath(path: string) {
  const match = /^\/legal\/(terms|privacy)(?:\/(v[0-9]+))?\/?$/.exec(path);
  if (!match) return null;

  const kind = match[1] as LegalDocKind;
  const requestedVersion = match[2];
  const document = currentDocs[kind];

  if (requestedVersion && requestedVersion !== document.version) return null;
  return document;
}

function parseLegalDocument(kind: LegalDocKind, slug: string, source: string): LegalDocument {
  const { frontmatter, body } = parseFrontmatter(source);
  const version = frontmatter.version || 'v1';
  const title = frontmatter.title || (kind === 'terms' ? 'Terms of Service' : 'Privacy Policy');
  const description = frontmatter.description || `${title} for infraflow.`;

  return {
    kind,
    slug,
    version,
    effectiveDate: frontmatter.effectiveDate || '',
    title,
    description,
    markdown: body,
    html: markdownToHtml(body),
  };
}

function parseFrontmatter(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.trim());
  if (!match) return { frontmatter: {} as Record<string, string>, body: source };

  const frontmatter = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.split(/:\s*/))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key.trim(), value.join(': ').trim().replace(/^"|"$/g, '')]),
  );

  return { frontmatter, body: match[2] };
}
