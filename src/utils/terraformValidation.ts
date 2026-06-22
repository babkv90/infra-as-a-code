import type { ValidationIssue } from './validate';

export function validateGeneratedTerraform(terraform: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const addresses = new Map<string, number>();
  let braceDepth = 0;

  terraform.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    const block = line.match(/^(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{/);

    if (block) {
      const address = `${block[1]}.${block[2]}.${block[3]}`;
      const firstLine = addresses.get(address);
      if (firstLine) {
        issues.push({
          severity: 'error',
          message: `Generated Terraform has duplicate block "${address}" on lines ${firstLine} and ${lineNumber}.`,
        });
      } else {
        addresses.set(address, lineNumber);
      }
    }

    braceDepth += countCharOutsideQuotes(rawLine, '{');
    braceDepth -= countCharOutsideQuotes(rawLine, '}');

    if (braceDepth < 0) {
      issues.push({
        severity: 'error',
        message: `Generated Terraform has an unexpected closing brace near line ${lineNumber}.`,
      });
      braceDepth = 0;
    }
  });

  if (braceDepth !== 0) {
    issues.push({
      severity: 'error',
      message: 'Generated Terraform has unbalanced braces.',
    });
  }

  if (!terraform.includes('provider "aws"')) {
    issues.push({
      severity: 'error',
      message: 'Generated Terraform is missing the AWS provider block.',
    });
  }

  return issues;
}

function countCharOutsideQuotes(value: string, target: string): number {
  let count = 0;
  let inQuote = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && char === target) count += 1;
  }

  return count;
}
