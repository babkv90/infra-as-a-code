// Syntax-highlighted code panel for the article reader — one per `code` block from
// timelineScanner.js's parser (mermaid-language blocks are intercepted before reaching this
// component; see ContentBlocks.tsx). Deliberately its own dark panel rather than following the
// article's light theme: a code block reads as "terminal/editor," not "prose," on every
// publication that treats this well (Medium, Substack, docs sites all do the same).
import { Check, Copy } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { useState } from 'react';

const LANGUAGE_LABELS: Record<string, string> = {
  text: 'Text',
  plaintext: 'Text',
  json: 'JSON',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  markup: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  diff: 'Diff',
  markdown: 'Markdown',
};

// prism-react-renderer only ships grammars for a fixed set of languages — an unrecognized alias
// falls back to plain-text tokenization rather than throwing.
const KNOWN_LANGUAGES = new Set([
  'tsx', 'jsx', 'typescript', 'javascript', 'json', 'bash', 'python', 'yaml', 'markup', 'css', 'sql', 'go', 'rust', 'java', 'markdown', 'diff',
]);

const LANGUAGE_ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', html: 'markup' };

function normalizeLanguage(language: string) {
  const lower = language.toLowerCase();
  const resolved = LANGUAGE_ALIASES[lower] ?? lower;
  return KNOWN_LANGUAGES.has(resolved) ? resolved : 'plaintext';
}

export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const trimmedCode = code.replace(/\n$/, '');
  const showLineNumbers = trimmedCode.split('\n').length > 5;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(trimmedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied/unavailable — the button just never shows the copied state
    }
  }

  return (
    <div className="timeline-code">
      <div className="timeline-code__bar">
        <span className="timeline-code__lang">{LANGUAGE_LABELS[language.toLowerCase()] ?? (language ? language.toUpperCase() : 'Text')}</span>
        <button className="timeline-code__copy" onClick={() => void handleCopy()} type="button">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Highlight code={trimmedCode} language={normalizeLanguage(language)} theme={themes.oneDark}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`timeline-code__pre ${className}`} style={style}>
            <code>
              {tokens.map((line, lineIndex) => {
                const { className: lineClassName, key: _lineKey, ...lineProps } = getLineProps({ line });
                return (
                  <div className={`timeline-code__line ${lineClassName ?? ''}`} key={lineIndex} {...lineProps}>
                    {showLineNumbers && <span className="timeline-code__line-number">{lineIndex + 1}</span>}
                    <span className="timeline-code__line-content">
                      {line.map((token, tokenIndex) => {
                        const { key: _tokenKey, ...tokenProps } = getTokenProps({ token });
                        return <span key={tokenIndex} {...tokenProps} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        )}
      </Highlight>
    </div>
  );
}
