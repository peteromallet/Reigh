/**
 * Presence-match semantics for deferred/unsupported absence checks.
 *
 * A source comment may explicitly document a limitation (for example,
 * "does not sandbox trusted extension code"). Such a comment is evidence for
 * the absence claim, not an implementation of the deferred capability. Keep
 * this exception deliberately lexical: executable source that contains the
 * same words remains a presence match.
 */

function ripgrepText(line) {
  // `rg --line-number --no-heading` emits `path:line:text`.
  return line.match(/^.*?:\d+:(.*)$/s)?.[1] ?? line;
}

function isCommentText(text) {
  const trimmed = text.trim();
  return trimmed.startsWith('//')
    || trimmed.startsWith('/*')
    || trimmed.startsWith('*')
    || trimmed.startsWith('#');
}

function isProseText(text) {
  return isCommentText(text)
    // Test descriptions and matcher literals document expected absence; they
    // do not claim that the runtime implements the capability.
    || /^\s*(?:it|test)\s*\(\s*['"`]/i.test(text)
    || /\b(?:toMatch|toContain|toEqual)\s*\(/.test(text);
}

function hasNegativeRelation(text, pattern) {
  let match;
  try {
    match = new RegExp(pattern, 'i').exec(text);
  } catch {
    return false;
  }
  if (!match || match.index === undefined) return false;

  const before = text.slice(Math.max(0, match.index - 100), match.index);
  const after = text.slice(match.index, match.index + 120);
  const negatingVerb = /(?:does\s+not|do\s+not|did\s+not|will\s+not|would\s+not|cannot|can't|doesn't|don't|won't|den(?:y|ies|ied))\s+(?:\w+\s+){0,4}$/i;
  const negatingState = /(?:^|\s)(?:is|are|was|were)\s+not\s+(?:\w+\s+){0,3}$/i;
  const negatingNoun = /(?:^|[^\w])(?:no|without|not)\s+(?:an?\s+)?(?:\w+\s+){0,2}$/i;
  const postposedNegation = /^(?:[\w-]+\s+){0,4}(?:is|are|was|were)\s+not\b/i;
  return /\bun$/i.test(before)
    || negatingVerb.test(before)
    || negatingState.test(before)
    || negatingNoun.test(before)
    || postposedNegation.test(after.slice(match[0].length));
}

/**
 * Return true only for a source comment that explicitly negates the matched
 * capability. Code and positive claims are intentionally not exempted.
 */
export function isExplicitNegativeLimitation(line, pattern) {
  const text = ripgrepText(line);
  return isProseText(text) && hasNegativeRelation(text, pattern);
}

/**
 * Filter raw ripgrep lines to semantic presence matches.
 *
 * @param {string[]} lines raw `rg --line-number --no-heading` output
 * @param {string} pattern regex passed to rg
 * @returns {string[]}
 */
export function filterSemanticPresenceMatches(lines, pattern) {
  return lines.filter((line) => !isExplicitNegativeLimitation(line, pattern));
}
