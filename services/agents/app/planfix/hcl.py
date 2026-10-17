"""Reads single blocks out of generated Terraform, so the plan-fix agent can look at exactly the
resource a plan error points at instead of carrying the whole main.tf in its context."""

import re

_HEADER = re.compile(r'^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{')


def list_addresses(terraform: str) -> list[str]:
    addresses = []
    for line in terraform.splitlines():
        match = _HEADER.match(line)
        if match:
            kind, type_, name = match.groups()
            addresses.append(f"data.{type_}.{name}" if kind == "data" else f"{type_}.{name}")
    return addresses


def extract_block(terraform: str, address: str) -> str | None:
    """The full text of `address`'s block (`aws_x.name` or `data.aws_x.name`), or None.
    Brace counting ignores braces inside double-quoted strings."""
    wanted = address.strip().removeprefix("resource.")
    lines = terraform.splitlines()
    for start, line in enumerate(lines):
        match = _HEADER.match(line)
        if not match:
            continue
        kind, type_, name = match.groups()
        found = f"data.{type_}.{name}" if kind == "data" else f"{type_}.{name}"
        if found != wanted:
            continue

        depth = 0
        for end in range(start, len(lines)):
            depth += _count_outside_quotes(lines[end], "{") - _count_outside_quotes(lines[end], "}")
            if depth <= 0:
                return "\n".join(lines[start : end + 1])
        return "\n".join(lines[start:])
    return None


def _count_outside_quotes(line: str, char: str) -> int:
    count, in_quotes, escaped = 0, False, False
    for ch in line:
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == '"':
            in_quotes = not in_quotes
        elif ch == char and not in_quotes:
            count += 1
    return count
