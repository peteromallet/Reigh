import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkAstridDoctorAvailabilityMock } = vi.hoisted(() => ({
  checkAstridDoctorAvailabilityMock: vi.fn(),
}));

vi.mock('@/integrations/astrid/doctorAvailability.ts', () => ({
  ASTRID_DOCTOR_COMMAND: 'python3 -m astrid doctor --json',
  checkAstridDoctorAvailability: checkAstridDoctorAvailabilityMock,
}));

vi.mock('@/shared/components/ui/dialog', () => ({
  DialogHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

import { SetupCompleteStep } from './SetupCompleteStep';

describe('SetupCompleteStep doctor availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAstridDoctorAvailabilityMock.mockResolvedValue({ status: 'available' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks the local bridge and enables creation only after it is available', async () => {
    let resolveCheck: ((value: { status: 'available' }) => void) | undefined;
    checkAstridDoctorAvailabilityMock.mockReturnValue(new Promise((resolve) => {
      resolveCheck = resolve;
    }));

    render(<SetupCompleteStep onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking that Astrid');
    expect(screen.getByRole('button', { name: 'Start Creating' })).toBeDisabled();

    resolveCheck?.({ status: 'available' });
    expect(await screen.findByText('Astrid is ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Creating' })).toBeEnabled();
  });

  it('starts creating after the doctor-owned runtime is available', async () => {
    const onClose = vi.fn();
    render(<SetupCompleteStep onClose={onClose} />);

    await screen.findByText('Astrid is ready');
    fireEvent.click(screen.getByRole('button', { name: 'Start Creating' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the capability-unavailable doctor hint and recovers on retry', async () => {
    checkAstridDoctorAvailabilityMock
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'connection refused' })
      .mockResolvedValueOnce({ status: 'available' });

    render(<SetupCompleteStep onClose={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A local capability is unavailable');
    expect(alert).toHaveTextContent('connection refused');
    expect(alert).toHaveTextContent('python3 -m astrid doctor --json');

    fireEvent.click(screen.getByRole('button', { name: 'Check Astrid Again' }));

    await waitFor(() => expect(screen.getByText('Astrid is ready')).toBeInTheDocument());
    expect(checkAstridDoctorAvailabilityMock).toHaveBeenCalledTimes(2);
  });
});
