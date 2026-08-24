import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const EXTERNAL_EVIDENCE_SCHEMA_VERSION = 1;
export const EXTERNAL_EVIDENCE_TYPES = Object.freeze([
  'transcript-owner-acknowledgement',
  'rollout-stage',
  'production-observability',
  'recovery-drill',
  'human-persona-session',
  'independent-review',
]);

export const EXTERNAL_EVIDENCE_TYPE_BY_WORKSTREAM = new Map([
  [10, 'transcript-owner-acknowledgement'],
  [19, 'rollout-stage'],
  [20, 'production-observability'],
  [21, 'recovery-drill'],
  [22, 'human-persona-session'],
  [23, 'independent-review'],
]);

export const REQUIRED_HUMAN_PERSONAS = Object.freeze([
  'video-editor',
  'accessibility-user',
  'transcript-specialist',
  'first-time-extension-author',
]);

export const REQUIRED_OBSERVABILITY_EVENT_FAMILIES = Object.freeze([
  'host-activation',
  'extension-lifecycle',
  'command-outcome',
  'bridge-request',
  'persistence-conflict',
  'migration-outcome',
  'render-export',
  'lane-density',
]);

export const REQUIRED_ALERT_DRILLS = Object.freeze([
  'missing-revision-telemetry',
  'unknown-error-class',
  'rejection-spike',
  'broken-dashboard',
]);

export const REQUIRED_RECOVERY_DRILLS = Object.freeze([
  'rapid-disable-rollback',
  'corrupt-data',
  'failed-migration',
]);

export const REQUIRED_HUMAN_TASKS = Object.freeze({
  'video-editor': [
    'extension-journey', 'dense-lane-edit', 'reload-restart-persistence',
    'safe-failure-recovery', 'render-export',
  ],
  'accessibility-user': [
    'keyboard-only', 'focus-retention', 'names-state-announcements', 'zoom-200',
    'reduced-motion', 'error-recovery',
  ],
  'transcript-specialist': [
    'regenerate', 'preserve', 'accept', 'split', 'merge', 'delete', 'retime',
    'overlapping-speakers', 'empty-text', 'unicode', 'source-correction-boundary',
  ],
  'first-time-extension-author': [
    'public-sdk-only', 'build-extension', 'diagnose-failure', 'enable-invoke',
    'render-export',
  ],
});

export const REQUIRED_REVIEW_SCOPE = Object.freeze({
  A: ['release-gates', 'clean-machine-reproduction', 'rollout', 'production-observability', 'rollback'],
  B: ['persistence', 'recovery-migration', 'transcript-policy', 'accessibility', 'render-export', 'human-acceptance'],
});

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NON_EMPTY = /\S/;

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function at(prefix, field) {
  return prefix ? `${prefix}.${field}` : field;
}

function object(value, path, required, allowed, errors) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`${at(path, field)} is required`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) errors.push(`${at(path, field)} is not allowed`);
  }
  return true;
}

function string(value, path, errors) {
  if (typeof value !== 'string' || !NON_EMPTY.test(value)) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function exact(value, expected, path, errors) {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function enumValue(value, allowed, path, errors) {
  if (!allowed.includes(value)) errors.push(`${path} must be one of ${allowed.join(', ')}`);
}

function sha(value, path, errors) {
  if (!SHA256.test(value ?? '')) errors.push(`${path} must be a lowercase SHA-256`);
}

function timestamp(value, path, errors) {
  if (!isUtcTimestamp(value)) errors.push(`${path} must be an exact UTC ISO timestamp`);
}

function array(value, path, errors, { min = 1, exactLength } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  if (exactLength !== undefined && value.length !== exactLength) {
    errors.push(`${path} must contain exactly ${exactLength} entries`);
  } else if (value.length < min) {
    errors.push(`${path} must contain at least ${min} entr${min === 1 ? 'y' : 'ies'}`);
  }
  return true;
}

function stringArray(value, path, errors, options) {
  if (!array(value, path, errors, options)) return;
  value.forEach((entry, index) => string(entry, `${path}[${index}]`, errors));
}

function hashRef(value, path, errors) {
  if (!object(value, path, ['path', 'sha256'], ['path', 'sha256'], errors)) return;
  string(value.path, `${path}.path`, errors);
  sha(value.sha256, `${path}.sha256`, errors);
}

function hashRefArray(value, path, errors, options) {
  if (!array(value, path, errors, options)) return;
  value.forEach((entry, index) => hashRef(entry, `${path}[${index}]`, errors));
}

function finding(value, path, errors) {
  const fields = ['id', 'severity', 'summary', 'owner', 'dueAt', 'disposition', 'evidenceRefs'];
  if (!object(value, path, fields, fields, errors)) return;
  string(value.id, `${path}.id`, errors);
  enumValue(value.severity, ['sev0', 'sev1', 'sev2', 'sev3'], `${path}.severity`, errors);
  string(value.summary, `${path}.summary`, errors);
  string(value.owner, `${path}.owner`, errors);
  timestamp(value.dueAt, `${path}.dueAt`, errors);
  enumValue(value.disposition, ['fixed', 'accepted', 'rejected'], `${path}.disposition`, errors);
  hashRefArray(value.evidenceRefs, `${path}.evidenceRefs`, errors);
  if (['sev0', 'sev1'].includes(value.severity) && value.disposition !== 'fixed') {
    errors.push(`${path} release-blocking findings must be fixed`);
  }
}

function findings(value, path, errors) {
  if (!array(value, path, errors, { min: 0 })) return;
  const ids = new Set();
  value.forEach((entry, index) => {
    finding(entry, `${path}[${index}]`, errors);
    if (typeof entry?.id === 'string' && ids.has(entry.id)) {
      errors.push(`${path}[${index}].id duplicates ${entry.id}`);
    }
    ids.add(entry?.id);
  });
}

function validateEnvelope(document, errors, expected = {}) {
  const fields = [
    'schemaVersion', 'evidenceType', 'release', 'candidate', 'capturedAt',
    'environment', 'record',
  ];
  if (!object(document, 'document', fields, fields, errors)) return false;
  exact(document.schemaVersion, EXTERNAL_EVIDENCE_SCHEMA_VERSION, 'document.schemaVersion', errors);
  enumValue(document.evidenceType, EXTERNAL_EVIDENCE_TYPES, 'document.evidenceType', errors);
  string(document.release, 'document.release', errors);
  if (typeof document.release === 'string'
      && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(document.release)) {
    errors.push('document.release must be a safe release identifier');
  }
  timestamp(document.capturedAt, 'document.capturedAt', errors);

  if (object(
    document.candidate,
    'document.candidate',
    ['reighCommit', 'astridCommit'],
    ['reighCommit', 'astridCommit'],
    errors,
  )) {
    if (!COMMIT.test(document.candidate.reighCommit ?? '')) {
      errors.push('document.candidate.reighCommit must be a lowercase 40-character commit');
    }
    if (!COMMIT.test(document.candidate.astridCommit ?? '')) {
      errors.push('document.candidate.astridCommit must be a lowercase 40-character commit');
    }
  }

  if (object(
    document.environment,
    'document.environment',
    ['id', 'toolVersions'],
    ['id', 'toolVersions'],
    errors,
  )) {
    string(document.environment.id, 'document.environment.id', errors);
    if (!isObject(document.environment.toolVersions)
        || Object.keys(document.environment.toolVersions).length === 0) {
      errors.push('document.environment.toolVersions must be a non-empty object');
    } else {
      for (const [tool, version] of Object.entries(document.environment.toolVersions)) {
        string(tool, 'document.environment.toolVersions key', errors);
        string(version, `document.environment.toolVersions.${tool}`, errors);
      }
    }
  }

  if (expected.release !== undefined && document.release !== expected.release) {
    errors.push('document.release does not match the evidence ledger');
  }
  if (expected.reighCommit !== undefined
      && document.candidate?.reighCommit !== expected.reighCommit) {
    errors.push('document.candidate.reighCommit does not match the evidence ledger candidate');
  }
  if (expected.astridCommit !== undefined
      && document.candidate?.astridCommit !== expected.astridCommit) {
    errors.push('document.candidate.astridCommit does not match the evidence ledger candidate');
  }
  if (expected.evidenceType !== undefined && document.evidenceType !== expected.evidenceType) {
    errors.push(`document.evidenceType must be ${expected.evidenceType}`);
  }
  return true;
}

function validateTranscript(record, errors) {
  const fields = ['handoff', 'acknowledgement', 'tests'];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  const binding = [
    'handoffId', 'ownerId', 'sourceRevision', 'returnedRevision',
    'handoffFingerprint', 'appliedSourceFingerprint',
  ];
  const handoffFields = [...binding, 'evidence'];
  if (object(record.handoff, 'document.record.handoff', handoffFields, handoffFields, errors)) {
    for (const field of binding.slice(0, 4)) {
      string(record.handoff[field], `document.record.handoff.${field}`, errors);
    }
    sha(record.handoff.handoffFingerprint, 'document.record.handoff.handoffFingerprint', errors);
    sha(record.handoff.appliedSourceFingerprint, 'document.record.handoff.appliedSourceFingerprint', errors);
    hashRef(record.handoff.evidence, 'document.record.handoff.evidence', errors);
    if (record.handoff.sourceRevision === record.handoff.returnedRevision) {
      errors.push('document.record.handoff.returnedRevision must differ from sourceRevision');
    }
  }
  const acknowledgementFields = [...binding, 'status', 'acknowledgedAt', 'evidence'];
  if (object(
    record.acknowledgement,
    'document.record.acknowledgement',
    acknowledgementFields,
    acknowledgementFields,
    errors,
  )) {
    for (const field of binding.slice(0, 4)) {
      string(record.acknowledgement[field], `document.record.acknowledgement.${field}`, errors);
    }
    sha(
      record.acknowledgement.handoffFingerprint,
      'document.record.acknowledgement.handoffFingerprint',
      errors,
    );
    sha(
      record.acknowledgement.appliedSourceFingerprint,
      'document.record.acknowledgement.appliedSourceFingerprint',
      errors,
    );
    exact(
      record.acknowledgement.status,
      'acknowledged-by-source-owner',
      'document.record.acknowledgement.status',
      errors,
    );
    timestamp(record.acknowledgement.acknowledgedAt, 'document.record.acknowledgement.acknowledgedAt', errors);
    hashRef(record.acknowledgement.evidence, 'document.record.acknowledgement.evidence', errors);
    for (const field of binding) {
      if (record.acknowledgement[field] !== record.handoff?.[field]) {
        errors.push(`document.record.acknowledgement.${field} must exactly match handoff.${field}`);
      }
    }
  }
  const requiredTests = [
    'regenerate', 'preserve', 'accept', 'split', 'merge', 'deletion', 'retiming',
    'overlapping-speakers', 'empty-text', 'unicode',
  ];
  if (object(record.tests, 'document.record.tests', requiredTests, requiredTests, errors)) {
    for (const field of requiredTests) exact(record.tests[field], 'pass', `document.record.tests.${field}`, errors);
  }
}

function validateRolloutRead(read, path, errors) {
  const fields = ['source', 'capturedAt', 'configRevision', 'flags', 'route', 'evidence'];
  if (!object(read, path, fields, fields, errors)) return;
  string(read.source, `${path}.source`, errors);
  timestamp(read.capturedAt, `${path}.capturedAt`, errors);
  string(read.configRevision, `${path}.configRevision`, errors);
  const flagNames = ['host', 'transcript-foundry', 'runaway'];
  if (object(read.flags, `${path}.flags`, flagNames, flagNames, errors)) {
    for (const name of flagNames) {
      if (typeof read.flags[name] !== 'boolean') errors.push(`${path}.flags.${name} must be boolean`);
    }
  }
  const routeFields = ['routeId', 'cohort', 'percentage'];
  if (object(read.route, `${path}.route`, routeFields, routeFields, errors)) {
    string(read.route.routeId, `${path}.route.routeId`, errors);
    string(read.route.cohort, `${path}.route.cohort`, errors);
    if (!Number.isInteger(read.route.percentage)
        || read.route.percentage < 0 || read.route.percentage > 100) {
      errors.push(`${path}.route.percentage must be an integer from 0 to 100`);
    }
  }
  hashRef(read.evidence, `${path}.evidence`, errors);
}

function validateRollout(record, errors) {
  const fields = ['stage', 'changedFlag', 'reads', 'drill', 'owners', 'outcome'];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  if (!Number.isInteger(record.stage) || record.stage < 0 || record.stage > 5) {
    errors.push('document.record.stage must be an integer from 0 to 5');
  }
  enumValue(record.changedFlag, ['host', 'transcript-foundry', 'runaway'], 'document.record.changedFlag', errors);
  if (array(record.reads, 'document.record.reads', errors, { exactLength: 2 })) {
    record.reads.forEach((read, index) => validateRolloutRead(read, `document.record.reads[${index}]`, errors));
    const [first, second] = record.reads;
    if (first?.source === second?.source) errors.push('document.record.reads must use two independent sources');
    for (const field of ['configRevision']) {
      if (first?.[field] !== second?.[field]) errors.push(`document.record.reads disagree on ${field}`);
    }
    if (JSON.stringify(first?.flags) !== JSON.stringify(second?.flags)) {
      errors.push('document.record.reads disagree on effective flags');
    }
    if (JSON.stringify(first?.route) !== JSON.stringify(second?.route)) {
      errors.push('document.record.reads disagree on effective route');
    }
  }
  const drillFields = ['kind', 'startedAt', 'completedAt', 'expected', 'observed', 'outcome', 'evidence'];
  if (object(record.drill, 'document.record.drill', drillFields, drillFields, errors)) {
    enumValue(record.drill.kind, ['emergency-disable', 'route-change'], 'document.record.drill.kind', errors);
    timestamp(record.drill.startedAt, 'document.record.drill.startedAt', errors);
    timestamp(record.drill.completedAt, 'document.record.drill.completedAt', errors);
    string(record.drill.expected, 'document.record.drill.expected', errors);
    string(record.drill.observed, 'document.record.drill.observed', errors);
    exact(record.drill.outcome, 'pass', 'document.record.drill.outcome', errors);
    hashRef(record.drill.evidence, 'document.record.drill.evidence', errors);
  }
  stringArray(record.owners, 'document.record.owners', errors, { min: 4 });
  exact(record.outcome, 'pass', 'document.record.outcome', errors);
}

function validateObservability(record, errors, document) {
  const fields = [
    'deployment', 'releaseRevision', 'syntheticProbe', 'dashboard', 'rateLimit',
    'alertDrills', 'privacyAudit', 'outcome',
  ];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  exact(record.deployment, 'production', 'document.record.deployment', errors);
  string(record.releaseRevision, 'document.record.releaseRevision', errors);
  exact(record.releaseRevision, document.candidate?.reighCommit, 'document.record.releaseRevision', errors);
  const probeFields = ['id', 'capturedAt', 'eventFamilies', 'outcome', 'evidence'];
  if (object(record.syntheticProbe, 'document.record.syntheticProbe', probeFields, probeFields, errors)) {
    string(record.syntheticProbe.id, 'document.record.syntheticProbe.id', errors);
    timestamp(record.syntheticProbe.capturedAt, 'document.record.syntheticProbe.capturedAt', errors);
    stringArray(record.syntheticProbe.eventFamilies, 'document.record.syntheticProbe.eventFamilies', errors);
    const families = new Set(record.syntheticProbe.eventFamilies);
    for (const family of REQUIRED_OBSERVABILITY_EVENT_FAMILIES) {
      if (!families.has(family)) errors.push(`document.record.syntheticProbe.eventFamilies is missing ${family}`);
    }
    exact(record.syntheticProbe.outcome, 'pass', 'document.record.syntheticProbe.outcome', errors);
    hashRef(record.syntheticProbe.evidence, 'document.record.syntheticProbe.evidence', errors);
  }
  const dashboardFields = ['id', 'revisionFilter', 'inspectedAt', 'targetRevisionStatus', 'evidence'];
  if (object(record.dashboard, 'document.record.dashboard', dashboardFields, dashboardFields, errors)) {
    string(record.dashboard.id, 'document.record.dashboard.id', errors);
    exact(record.dashboard.revisionFilter, record.releaseRevision, 'document.record.dashboard.revisionFilter', errors);
    timestamp(record.dashboard.inspectedAt, 'document.record.dashboard.inspectedAt', errors);
    exact(record.dashboard.targetRevisionStatus, 'healthy', 'document.record.dashboard.targetRevisionStatus', errors);
    hashRef(record.dashboard.evidence, 'document.record.dashboard.evidence', errors);
  }
  const limitFields = ['distributed', 'enforcementPoint', 'allowedCount', 'rejectedCount', 'testedAt', 'outcome', 'evidence'];
  if (object(record.rateLimit, 'document.record.rateLimit', limitFields, limitFields, errors)) {
    exact(record.rateLimit.distributed, true, 'document.record.rateLimit.distributed', errors);
    string(record.rateLimit.enforcementPoint, 'document.record.rateLimit.enforcementPoint', errors);
    for (const field of ['allowedCount', 'rejectedCount']) {
      if (!Number.isInteger(record.rateLimit[field]) || record.rateLimit[field] < 1) {
        errors.push(`document.record.rateLimit.${field} must be a positive integer`);
      }
    }
    timestamp(record.rateLimit.testedAt, 'document.record.rateLimit.testedAt', errors);
    exact(record.rateLimit.outcome, 'pass', 'document.record.rateLimit.outcome', errors);
    hashRef(record.rateLimit.evidence, 'document.record.rateLimit.evidence', errors);
  }
  if (array(record.alertDrills, 'document.record.alertDrills', errors)) {
    const seen = new Set();
    record.alertDrills.forEach((drill, index) => {
      const path = `document.record.alertDrills[${index}]`;
      const drillFields = ['kind', 'firedAt', 'acknowledgedBy', 'acknowledgedAt', 'runbookLinked', 'outcome', 'evidence'];
      if (!object(drill, path, drillFields, drillFields, errors)) return;
      enumValue(drill.kind, REQUIRED_ALERT_DRILLS, `${path}.kind`, errors);
      timestamp(drill.firedAt, `${path}.firedAt`, errors);
      string(drill.acknowledgedBy, `${path}.acknowledgedBy`, errors);
      timestamp(drill.acknowledgedAt, `${path}.acknowledgedAt`, errors);
      exact(drill.runbookLinked, true, `${path}.runbookLinked`, errors);
      exact(drill.outcome, 'pass', `${path}.outcome`, errors);
      hashRef(drill.evidence, `${path}.evidence`, errors);
      seen.add(drill.kind);
    });
    for (const kind of REQUIRED_ALERT_DRILLS) {
      if (!seen.has(kind)) errors.push(`document.record.alertDrills is missing ${kind}`);
    }
  }
  const privacyFields = ['inspectedAt', 'inspectedBy', 'forbiddenFieldsFound', 'outcome', 'evidence'];
  if (object(record.privacyAudit, 'document.record.privacyAudit', privacyFields, privacyFields, errors)) {
    timestamp(record.privacyAudit.inspectedAt, 'document.record.privacyAudit.inspectedAt', errors);
    string(record.privacyAudit.inspectedBy, 'document.record.privacyAudit.inspectedBy', errors);
    exact(record.privacyAudit.forbiddenFieldsFound, 0, 'document.record.privacyAudit.forbiddenFieldsFound', errors);
    exact(record.privacyAudit.outcome, 'pass', 'document.record.privacyAudit.outcome', errors);
    hashRef(record.privacyAudit.evidence, 'document.record.privacyAudit.evidence', errors);
  }
  exact(record.outcome, 'pass', 'document.record.outcome', errors);
}

function validateRecovery(record, errors) {
  const fields = ['drillType', 'incidentId', 'backup', 'hashes', 'timeline', 'approvals', 'checks', 'outcome'];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  enumValue(record.drillType, REQUIRED_RECOVERY_DRILLS, 'document.record.drillType', errors);
  string(record.incidentId, 'document.record.incidentId', errors);
  const backupFields = ['id', 'createdAt', 'toolVersion', 'sha256', 'readVerified'];
  if (object(record.backup, 'document.record.backup', backupFields, backupFields, errors)) {
    string(record.backup.id, 'document.record.backup.id', errors);
    timestamp(record.backup.createdAt, 'document.record.backup.createdAt', errors);
    string(record.backup.toolVersion, 'document.record.backup.toolVersion', errors);
    sha(record.backup.sha256, 'document.record.backup.sha256', errors);
    exact(record.backup.readVerified, true, 'document.record.backup.readVerified', errors);
  }
  const hashFields = ['preState', 'backup', 'restoredState', 'postState'];
  if (object(record.hashes, 'document.record.hashes', hashFields, hashFields, errors)) {
    for (const field of hashFields) sha(record.hashes[field], `document.record.hashes.${field}`, errors);
    if (record.hashes.backup !== record.backup?.sha256) {
      errors.push('document.record.hashes.backup must match backup.sha256');
    }
  }
  if (array(record.timeline, 'document.record.timeline', errors, { min: 4 })) {
    let previous = -Infinity;
    const actions = new Set();
    record.timeline.forEach((event, index) => {
      const path = `document.record.timeline[${index}]`;
      const eventFields = ['at', 'actor', 'action', 'outcome'];
      if (!object(event, path, eventFields, eventFields, errors)) return;
      timestamp(event.at, `${path}.at`, errors);
      string(event.actor, `${path}.actor`, errors);
      string(event.action, `${path}.action`, errors);
      enumValue(event.outcome, ['pass', 'fail', 'contained'], `${path}.outcome`, errors);
      actions.add(event.action);
      const parsed = Date.parse(event.at);
      if (Number.isFinite(parsed) && parsed < previous) errors.push(`${path}.at must be chronological`);
      previous = parsed;
    });
    for (const action of ['disable', 'backup', 'restore', 'verify']) {
      if (!actions.has(action)) errors.push(`document.record.timeline is missing ${action}`);
    }
  }
  if (array(record.approvals, 'document.record.approvals', errors, { min: 3 })) {
    const roles = new Set();
    const principals = new Set();
    record.approvals.forEach((approval, index) => {
      const path = `document.record.approvals[${index}]`;
      const approvalFields = ['role', 'principal', 'approvedAt', 'decision'];
      if (!object(approval, path, approvalFields, approvalFields, errors)) return;
      enumValue(approval.role, ['incident-commander', 'release-dri', 'data-or-service-owner'], `${path}.role`, errors);
      string(approval.principal, `${path}.principal`, errors);
      timestamp(approval.approvedAt, `${path}.approvedAt`, errors);
      exact(approval.decision, 'approve', `${path}.decision`, errors);
      roles.add(approval.role);
      principals.add(approval.principal);
    });
    for (const role of ['incident-commander', 'release-dri', 'data-or-service-owner']) {
      if (!roles.has(role)) errors.push(`document.record.approvals is missing ${role}`);
    }
    if (principals.size < 3) errors.push('document.record.approvals requires three distinct principals');
  }
  const checkFields = [
    'flagsOff', 'writersStopped', 'restoreVerified', 'restartVerified',
    'renderExportVerified', 'secondRunIdempotent', 'zeroDuplicates',
  ];
  if (object(record.checks, 'document.record.checks', checkFields, checkFields, errors)) {
    for (const field of checkFields) exact(record.checks[field], true, `document.record.checks.${field}`, errors);
  }
  exact(record.outcome, 'pass', 'document.record.outcome', errors);
}

function validateHuman(record, errors) {
  const fields = [
    'sessionId', 'persona', 'participant', 'projectFixtureId', 'browserDevice',
    'assistiveTechnologies', 'inputMethods', 'taskGoals', 'tasks', 'persistedState',
    'renderExport', 'privacy', 'findings', 'decision',
  ];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  string(record.sessionId, 'document.record.sessionId', errors);
  enumValue(record.persona, REQUIRED_HUMAN_PERSONAS, 'document.record.persona', errors);
  const participantFields = ['principal', 'consentRecordId'];
  if (object(record.participant, 'document.record.participant', participantFields, participantFields, errors)) {
    string(record.participant.principal, 'document.record.participant.principal', errors);
    string(record.participant.consentRecordId, 'document.record.participant.consentRecordId', errors);
  }
  string(record.projectFixtureId, 'document.record.projectFixtureId', errors);
  const browserFields = ['browser', 'version', 'device'];
  if (object(record.browserDevice, 'document.record.browserDevice', browserFields, browserFields, errors)) {
    for (const field of browserFields) string(record.browserDevice[field], `document.record.browserDevice.${field}`, errors);
  }
  stringArray(record.assistiveTechnologies, 'document.record.assistiveTechnologies', errors, { min: 0 });
  stringArray(record.inputMethods, 'document.record.inputMethods', errors);
  stringArray(record.taskGoals, 'document.record.taskGoals', errors);
  if (array(record.tasks, 'document.record.tasks', errors)) {
    record.tasks.forEach((task, index) => {
      const path = `document.record.tasks[${index}]`;
      const taskFields = ['id', 'outcome', 'durationSeconds', 'observations', 'evidenceRefs'];
      if (!object(task, path, taskFields, taskFields, errors)) return;
      string(task.id, `${path}.id`, errors);
      exact(task.outcome, 'pass', `${path}.outcome`, errors);
      if (!Number.isInteger(task.durationSeconds) || task.durationSeconds < 1) {
        errors.push(`${path}.durationSeconds must be a positive integer`);
      }
      stringArray(task.observations, `${path}.observations`, errors, { min: 0 });
      hashRefArray(task.evidenceRefs, `${path}.evidenceRefs`, errors);
    });
    const taskIds = new Set(record.tasks.map((task) => task?.id));
    for (const taskId of REQUIRED_HUMAN_TASKS[record.persona] ?? []) {
      if (!taskIds.has(taskId)) errors.push(`document.record.tasks is missing ${record.persona} task ${taskId}`);
    }
  }
  const stateFields = ['beforeSha256', 'afterRestartSha256', 'matchesExpected'];
  if (object(record.persistedState, 'document.record.persistedState', stateFields, stateFields, errors)) {
    sha(record.persistedState.beforeSha256, 'document.record.persistedState.beforeSha256', errors);
    sha(record.persistedState.afterRestartSha256, 'document.record.persistedState.afterRestartSha256', errors);
    exact(record.persistedState.matchesExpected, true, 'document.record.persistedState.matchesExpected', errors);
  }
  const renderFields = ['renderSha256', 'exportSha256', 'matchesExpected'];
  if (object(record.renderExport, 'document.record.renderExport', renderFields, renderFields, errors)) {
    sha(record.renderExport.renderSha256, 'document.record.renderExport.renderSha256', errors);
    sha(record.renderExport.exportSha256, 'document.record.renderExport.exportSha256', errors);
    exact(record.renderExport.matchesExpected, true, 'document.record.renderExport.matchesExpected', errors);
  }
  const privacyFields = ['capturesReviewed', 'prohibitedContentCollected'];
  if (object(record.privacy, 'document.record.privacy', privacyFields, privacyFields, errors)) {
    exact(record.privacy.capturesReviewed, true, 'document.record.privacy.capturesReviewed', errors);
    exact(record.privacy.prohibitedContentCollected, false, 'document.record.privacy.prohibitedContentCollected', errors);
  }
  findings(record.findings, 'document.record.findings', errors);
  exact(record.decision, 'approve', 'document.record.decision', errors);
}

function validateReview(record, errors) {
  const fields = [
    'slot', 'reviewer', 'independence', 'scope', 'findings', 'disposition',
    'evidenceIndex', 'verifiedArtifacts', 'verification',
  ];
  if (!object(record, 'document.record', fields, fields, errors)) return;
  enumValue(record.slot, ['A', 'B'], 'document.record.slot', errors);
  const reviewerFields = ['principal', 'team'];
  if (object(record.reviewer, 'document.record.reviewer', reviewerFields, reviewerFields, errors)) {
    string(record.reviewer.principal, 'document.record.reviewer.principal', errors);
    string(record.reviewer.team, 'document.record.reviewer.team', errors);
  }
  const independenceFields = ['statement', 'authoredScopes', 'conflicts', 'disqualifyingConflict'];
  if (object(record.independence, 'document.record.independence', independenceFields, independenceFields, errors)) {
    string(record.independence.statement, 'document.record.independence.statement', errors);
    stringArray(record.independence.authoredScopes, 'document.record.independence.authoredScopes', errors, { min: 0 });
    stringArray(record.independence.conflicts, 'document.record.independence.conflicts', errors, { min: 0 });
    exact(record.independence.disqualifyingConflict, false, 'document.record.independence.disqualifyingConflict', errors);
    if (record.independence.authoredScopes?.length > 0) {
      errors.push('document.record.independence.authoredScopes must be empty for an approving reviewer');
    }
  }
  stringArray(record.scope, 'document.record.scope', errors);
  const scope = new Set(record.scope);
  for (const requiredScope of REQUIRED_REVIEW_SCOPE[record.slot] ?? []) {
    if (!scope.has(requiredScope)) errors.push(`document.record.scope is missing slot ${record.slot} scope ${requiredScope}`);
  }
  findings(record.findings, 'document.record.findings', errors);
  exact(record.disposition, 'approve', 'document.record.disposition', errors);
  hashRef(record.evidenceIndex, 'document.record.evidenceIndex', errors);
  if (array(record.verifiedArtifacts, 'document.record.verifiedArtifacts', errors)) {
    record.verifiedArtifacts.forEach((entry, index) => hashRef(entry, `document.record.verifiedArtifacts[${index}]`, errors));
  }
  const verificationFields = ['freshCheckout', 'rawEvidenceInspected', 'hashesVerified', 'rollbackVerified'];
  if (object(record.verification, 'document.record.verification', verificationFields, verificationFields, errors)) {
    for (const field of verificationFields) exact(record.verification[field], true, `document.record.verification.${field}`, errors);
  }
}

const VALIDATORS = new Map([
  ['transcript-owner-acknowledgement', validateTranscript],
  ['rollout-stage', validateRollout],
  ['production-observability', validateObservability],
  ['recovery-drill', validateRecovery],
  ['human-persona-session', validateHuman],
  ['independent-review', validateReview],
]);

export function validateExternalEvidence(document, expected = {}) {
  const errors = [];
  if (!validateEnvelope(document, errors, expected)) return { errors };
  const validator = VALIDATORS.get(document.evidenceType);
  if (validator) validator(document.record, errors, document);
  return { errors };
}

export function externalEvidenceReferences(document) {
  const references = [];
  const add = (name, reference) => {
    if (reference !== undefined) references.push([name, reference]);
  };
  if (document?.evidenceType === 'transcript-owner-acknowledgement') {
    add('handoff.evidence', document.record?.handoff?.evidence);
    add('acknowledgement.evidence', document.record?.acknowledgement?.evidence);
  }
  if (document?.evidenceType === 'rollout-stage') {
    for (const [index, read] of (document.record?.reads ?? []).entries()) {
      add(`reads[${index}].evidence`, read?.evidence);
    }
    add('drill.evidence', document.record?.drill?.evidence);
  }
  if (document?.evidenceType === 'production-observability') {
    add('syntheticProbe.evidence', document.record?.syntheticProbe?.evidence);
    add('dashboard.evidence', document.record?.dashboard?.evidence);
    add('rateLimit.evidence', document.record?.rateLimit?.evidence);
    for (const [index, drill] of (document.record?.alertDrills ?? []).entries()) {
      add(`alertDrills[${index}].evidence`, drill?.evidence);
    }
    add('privacyAudit.evidence', document.record?.privacyAudit?.evidence);
  }
  if (document?.evidenceType === 'human-persona-session') {
    for (const [index, task] of (document.record?.tasks ?? []).entries()) {
      for (const [refIndex, reference] of (task?.evidenceRefs ?? []).entries()) {
        add(`tasks[${index}].evidenceRefs[${refIndex}]`, reference);
      }
    }
    for (const [index, finding] of (document.record?.findings ?? []).entries()) {
      for (const [refIndex, reference] of (finding?.evidenceRefs ?? []).entries()) {
        add(`findings[${index}].evidenceRefs[${refIndex}]`, reference);
      }
    }
  }
  if (document?.evidenceType === 'independent-review') {
    add('evidenceIndex', document.record?.evidenceIndex);
    for (const [index, reference] of (document.record?.verifiedArtifacts ?? []).entries()) {
      add(`verifiedArtifacts[${index}]`, reference);
    }
    for (const [index, finding] of (document.record?.findings ?? []).entries()) {
      for (const [refIndex, reference] of (finding?.evidenceRefs ?? []).entries()) {
        add(`findings[${index}].evidenceRefs[${refIndex}]`, reference);
      }
    }
  }
  return references;
}
