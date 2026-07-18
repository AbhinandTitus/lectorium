import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** rendered instead of children after an error; receives a retry fn */
  fallback?: (retry: () => void) => ReactNode;
  /** called once when an error is caught (e.g. to disable a feature) */
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in a subtree so a single failing component
 * (a broken 3D texture, a malformed book) can never blank the whole app.
 * Diagnostics go to the console/local log, never a raw stack in the UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[error-boundary]", error, info.componentStack);
    this.props.onError?.(error);
  }

  retry = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ? this.props.fallback(this.retry) : null;
    }
    return this.props.children;
  }
}
