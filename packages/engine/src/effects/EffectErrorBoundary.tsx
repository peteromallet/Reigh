import { Component, type ReactNode } from 'react';

type EffectErrorBoundaryProps = { effectName: string; fallback: ReactNode; children: ReactNode };
type EffectErrorBoundaryState = { hasError: boolean };

export class EffectErrorBoundary extends Component<EffectErrorBoundaryProps, EffectErrorBoundaryState> {
  state: EffectErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): EffectErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[EffectErrorBoundary] "${this.props.effectName}" runtime error: ${error.message}`);
  }

  componentDidUpdate(prevProps: EffectErrorBoundaryProps) {
    if (this.state.hasError && prevProps.effectName !== this.props.effectName) this.setState({ hasError: false });
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
