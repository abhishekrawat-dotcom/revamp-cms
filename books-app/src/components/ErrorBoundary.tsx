import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected editorial studio error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('BOOKSTUDIO ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#121214] text-[#ECEAE4] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#18181B] border border-white/[0.1] rounded-lg p-6 space-y-4">
            <h1 className="font-display text-xl text-[#F4F1EA]">BOOKSTUDIO Recovery</h1>
            <p className="text-xs text-[#A19E95] leading-relaxed">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded cursor-pointer"
            >
              Reload Studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
