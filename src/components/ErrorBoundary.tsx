import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-2xl bg-white/[0.02] border border-red-500/20 p-8 text-center space-y-3">
            <p className="text-sm text-red-400/70 font-light">
              Rendering-Fehler aufgetreten
            </p>
            <p className="text-[11px] text-white/25 font-light max-w-md mx-auto">
              {this.state.error?.message || "Unbekannter Fehler"}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-[11px] text-primary/60 hover:text-primary/90 transition-colors tracking-wider uppercase"
            >
              Erneut versuchen
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
