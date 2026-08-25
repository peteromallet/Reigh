/**
 * Presence-match semantics for deferred/unsupported absence checks.
 *
 * A source comment may explicitly document a limitation (for example,
 * "does not sandbox trusted extension code"). Such a comment is evidence for
 * the absence claim, not an implementation of the deferred capability. The
 * important detail is that this is an occurrence-level decision: a negative
 * occurrence must never hide a later, positive occurrence on the same line.
 */

function parseRipgrepLine(line) {
  // `rg --line-number --no-heading` emits `path:line:text`. The line-number
  // delimiter is the first `:<digits>:` segment emitted after the path. A
  // greedy path capture would instead consume source text such as `:123:` and
  // let an attacker hide an earlier positive claim from semantic scanning.
  const match = line.match(/^(.+?):(\d+):(.*)$/s);
  if (!match) return { path: null, lineNumber: null, text: line };
  return { path: match[1], lineNumber: Number(match[2]), text: match[3] };
}

function isCommentText(text) {
  const trimmed = text.trim();
  return trimmed.startsWith('//')
    || trimmed.startsWith('/*')
    || trimmed.startsWith('*')
    || trimmed.startsWith('#');
}

function isTestProse(text) {
  const trimmed = text.trim();
  return /^(?:it|test)(?:\.each)?\s*\(\s*['"`]/i.test(trimmed)
    || /\b(?:toMatch|toContain|toEqual|toHaveProperty|toThrow)\s*\(/.test(text);
}

function isProseText(text) {
  return isCommentText(text) || isTestProse(text);
}

function makeGlobalRegExp(pattern) {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

function regexOccurrences(text, pattern) {
  const expression = makeGlobalRegExp(pattern);
  if (!expression) return [];

  const occurrences = [];
  let match;
  while ((match = expression.exec(text)) !== null) {
    const value = match[0];
    occurrences.push({ value, index: match.index, end: match.index + value.length });
    // Avoid an infinite loop for a zero-width regex.
    if (value.length === 0) expression.lastIndex += 1;
  }
  return occurrences;
}

/**
 * Return the prose clause containing an occurrence. A semicolon or a
 * contrastive conjunction starts a new scope, so `no sandbox yet; sandbox
 * enforcement is implemented below` retains the second occurrence as a
 * positive claim.
 */
function clauseFor(text, occurrence) {
  const left = text.slice(0, occurrence.index);
  // A dot in `expect(...).not.toContain(...)` or `foo.bar` is code syntax,
  // not a prose boundary. A sentence-final dot is followed by whitespace or
  // the end of text, which is what the negative lookahead preserves.
  const punctuation = /[!?;:\n]|\.(?!\w)/g;
  let start = 0;
  let punctuationMatch;
  while ((punctuationMatch = punctuation.exec(left)) !== null) {
    start = punctuationMatch.index + 1;
  }

  // Do not split on plain `and`/`or`: they commonly coordinate one negative
  // claim (`no sandbox or iframe support`).
  const contrast = /\b(?:but|however|although|though|whereas|instead)\b/gi;
  let contrastMatch;
  while ((contrastMatch = contrast.exec(left)) !== null) {
    start = Math.max(start, contrastMatch.index + contrastMatch[0].length);
  }

  return {
    text: text.slice(start),
    before: text.slice(start, occurrence.index),
    after: text.slice(occurrence.end),
    start,
  };
}

const NEGATING_VERB = /\b(?:does|do|did|will|would|can|could|should|must|may|might|is|are|was|were|be|been|being)\s+(?:not|n't)\b/i;
const NEGATING_MODAL = /\b(?:cannot|can't|won't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't|don't|doesn't|didn't)\b/i;
const NEGATIVE_ACTION = /\b(?:fail|fails|failed|avoid|avoids|avoided|lack|lacks|lacked|refuse|refuses|refused|deny|denies|denied|prevent|prevents|prevented|prohibit|prohibits|prohibited|block|blocks|blocked|exclude|excludes|excluded|omit|omits|omitted|skip|skips|skipped)\s+(?:to\s+)?/i;
const NEGATIVE_ACTION_AT_END = /\b(?:fail|fails|failed|avoid|avoids|avoided|lack|lacks|lacked|refuse|refuses|refused|deny|denies|denied|prevent|prevents|prevented|prohibit|prohibits|prohibited|block|blocks|blocked|exclude|excludes|excluded|omit|omits|omitted|skip|skips|skipped)\s*$/i;
const NEGATIVE_STATE = /(?:not|n't|cannot|can't|won't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't)\s+(?:be\s+)?(?:implemented|supported|available|present|enforced|enabled|provided|offered|included|possible|permitted|allowed|secure|ready|real|existing|existent|provided|known|recognized|recognized|true|valid|there|exist|exists)\b/i;
const NEGATIVE_SUBJECT_AFTER = new RegExp(
  `^(?:\\s+(?:[\\w-]+)\\s+){0,5}${NEGATIVE_STATE.source}`,
  'i',
);

function wordsSinceLastBoundary(text) {
  // A long unrelated prefix should not turn a positive claim into a negative
  // one merely because it mentions `not` somewhere earlier in the paragraph.
  return text.trim().split(/\s+/).slice(-12).join(' ');
}

function isDoubleNegative(before, after) {
  const localBefore = wordsSinceLastBoundary(before);
  const localAfter = after.trim().slice(0, 80);

  // `does not fail to sandbox`, `not without sandbox`, and
  // `sandbox is not unsupported` are positive claims (two negations).
  if (/(?:not|n't)\s+(?:without|no|unsupported|deferred|absent|missing)\b/i.test(localBefore)) return true;
  if (new RegExp(`(?:not|n't)\\s+${NEGATIVE_ACTION.source}`, 'i').test(localBefore)) return true;
  if (/\b(?:is|are|was|were|be|been|being)\s+(?:not|n't)\s+(?:unsupported|deferred|absent|missing|unavailable)\b/i.test(localAfter)) return true;
  return false;
}

function hasNegativeRelation(text, occurrence) {
  if (!isProseText(text)) return false;
  const clause = clauseFor(text, occurrence);
  const before = clause.before;
  const after = clause.after;
  const localBefore = wordsSinceLastBoundary(before);
  // Keep the leading whitespace: postposed forms use it to distinguish the
  // capability from the words that follow it (`sandbox is not ...`).
  const localAfter = after.slice(0, 100);

  // `unsandboxed`/`non-sandboxed` can match at the `sandbox` substring.
  const adjacentPrefix = text.slice(Math.max(0, occurrence.index - 16), occurrence.index);
  const lexicalNegative = /(?:^|[\s/'"([{:])(?:un|non[- ]?)$/i.test(adjacentPrefix);

  const negativePrefix = /(?:^|[\s,/'"([{])(?:no|not|without|unsupported|deferred|absent|missing|unavailable|excluded)(?:\s+(?:an?|the|real|actual|proper|secure|runtime|execution|enforcement|support|supported|yet|currently|still))*\s*$/i;

  const negative = lexicalNegative
    || negativePrefix.test(localBefore)
    || NEGATIVE_ACTION_AT_END.test(localBefore.slice(-80))
    // Preserve a negation over a coordinated list (`no sandbox or iframe
    // support`, `without sandbox, permissions, or signing`). A contrastive
    // conjunction is already removed by clauseFor, so this cannot leak across
    // `no sandbox, but sandbox enforcement is implemented`.
    || /(?:^|[\s,/'"([{])(?:no|not|without|unsupported|deferred|absent|missing|unavailable|excluded)\b[^.!?;:]*\b(?:and|or)\s*$/i.test(localBefore)
    || NEGATING_VERB.test(localBefore.slice(-60))
    || NEGATING_MODAL.test(localBefore.slice(-60))
    || /(?:^|[\s,/'"([{])(?:out\s+of\s+scope|no|not|without|unsupported|deferred|absent|missing|unavailable|excluded)\b[\s\w'-]*$/i.test(localBefore)
    || /\bnot\s*\.\s*(?:toMatch|toContain|toEqual|toHaveProperty|toThrow)\s*\(/i.test(localBefore)
    || /^(?:\s*(?:is|are|was|were|be|been|being)\s+)?(?:not|unsupported|deferred|absent|missing|unavailable|out\s+of\s+scope)\b/i.test(localAfter)
    || /^(?:\s+(?:yet|currently|still))?\s*[,;]?\s*(?:(?:[\w-]+)\s+){0,5}(?:is|are|was|were|remains?|stays?)\s+(?:not|unsupported|deferred|absent|missing|unavailable)\b/i.test(localAfter)
    || NEGATIVE_SUBJECT_AFTER.test(localAfter);

  if (!negative) return false;
  // A coordinating negation may cover a list of different capabilities (`no
  // sandbox or iframe support`), but it must not hide a repeated capability
  // that starts an affirmative predicate (`no sandbox and sandbox enforcement
  // is implemented`). Treat that repeated, affirmative occurrence as a new
  // semantic scope even without punctuation.
  const repeatedCapability = before.toLowerCase().includes(occurrence.value.toLowerCase());
  const coordinatedRepeat = /\b(?:and|or)\s*$/i.test(localBefore);
  const affirmativeAfter = /^(?:\s+[\w-]+){0,5}\s+(?:is|are|was|were|will\s+be|has\s+been|have\s+been)\s+(?:implemented|supported|available|present|enforced|enabled|provided|offered|included|permitted|allowed|ready|real|existing|true|valid)\b/i.test(localAfter);
  if (repeatedCapability && coordinatedRepeat && affirmativeAfter) return false;
  if (isDoubleNegative(before, after)) return false;
  return true;
}

/**
 * Scan every regex occurrence and classify it independently.
 *
 * @param {string[]} lines raw `rg --line-number --no-heading` output
 * @param {string} pattern regex passed to rg
 * @returns {Array<{line:string,text:string,path:string|null,lineNumber:number|null,match:string,index:number,end:number,negative:boolean,clause:string}>}
 */
export function scanSemanticClaimOccurrences(lines, pattern) {
  const occurrences = [];
  for (const line of lines) {
    const parsed = parseRipgrepLine(line);
    for (const occurrence of regexOccurrences(parsed.text, pattern)) {
      const clause = clauseFor(parsed.text, occurrence);
      occurrences.push({
        line,
        text: parsed.text,
        path: parsed.path,
        lineNumber: parsed.lineNumber,
        match: occurrence.value,
        index: occurrence.index,
        end: occurrence.end,
        negative: hasNegativeRelation(parsed.text, occurrence),
        clause: clause.text,
      });
    }
  }
  return occurrences;
}

/** Return only positive/presence occurrences, retaining precise evidence. */
export function findSemanticPresenceMatches(lines, pattern) {
  return scanSemanticClaimOccurrences(lines, pattern).filter((occurrence) => !occurrence.negative);
}

// Descriptive alias for callers that prefer the scanner terminology.
export const scanSemanticPresenceMatches = findSemanticPresenceMatches;

/**
 * Return true only when every matched occurrence on a prose line is an
 * explicit negative limitation. Code and positive claims are not exempted.
 */
export function isExplicitNegativeLimitation(line, pattern) {
  const occurrences = scanSemanticClaimOccurrences([line], pattern);
  return occurrences.length > 0 && occurrences.every((occurrence) => occurrence.negative);
}

/**
 * Filter raw ripgrep lines to semantic presence matches. A line is retained
 * when at least one of its regex occurrences is a positive claim.
 *
 * @param {string[]} lines raw `rg --line-number --no-heading` output
 * @param {string} pattern regex passed to rg
 * @returns {string[]}
 */
export function filterSemanticPresenceMatches(lines, pattern) {
  const positiveLines = new Set(findSemanticPresenceMatches(lines, pattern).map((occurrence) => occurrence.line));
  return lines.filter((line) => positiveLines.has(line));
}
