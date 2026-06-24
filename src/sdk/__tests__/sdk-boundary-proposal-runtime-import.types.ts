/**
 * @publicContract
 * Type-only SDK boundary assertion for ProposalRuntime.importProposal.
 *
 * This file is compiled by npm run test:sdk-boundary. It intentionally keeps a
 * tiny surface so public proposal import drift is caught without pulling the
 * broad runtime boundary test into the targeted TypeScript gate.
 */

import type {
  ProposalRuntime,
  ProposalRuntimeImportStatus,
  TimelineProposal,
} from '@reigh/editor-sdk';

type IsExactType<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends
  (<T>() => T extends Expected ? 1 : 2)
    ? (<T>() => T extends Expected ? 1 : 2) extends
      (<T>() => T extends Actual ? 1 : 2)
      ? true
      : false
    : false;

type AssertExactType<Actual, Expected> = IsExactType<Actual, Expected> extends true
  ? true
  : never;

type ProposalRuntimeImportProposalContract = AssertExactType<
  ProposalRuntime['importProposal'],
  (proposal: TimelineProposal) => ProposalRuntimeImportStatus
>;

const proposalRuntimeImportProposalContract: ProposalRuntimeImportProposalContract = true;

export { proposalRuntimeImportProposalContract };
