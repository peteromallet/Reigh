// Keep the complete paired-release semantic safety suite on the normal Reigh
// Vitest path. The Playwright validator module remains the source of truth;
// this wrapper prevents its tests from becoming an orphaned release-only file.
import '../../../../tests/e2e/release/paired-repository.validators.test.ts';
