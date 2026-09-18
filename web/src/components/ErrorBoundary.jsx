import { Component } from 'react';

// Without a boundary, any render error unmounts the whole tree and leaves a
// blank page. This keeps the failure visible and recoverable.
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page">
        <main className="container main">
          <div className="notice notice--error" role="alert">
            <span>Something went wrong while rendering this page: {this.state.error.message}</span>
          </div>
          <a href="/dashboard" className="btn btn-outline">Back to dashboard</a>
        </main>
      </div>
    );
  }
}

export default ErrorBoundary;
