import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100vh', gap: '16px',
                    background: '#1a1a1a', color: '#e8e3de', fontFamily: 'inherit',
                    padding: '24px', textAlign: 'center',
                }}>
                    <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#e06c75' }}>
                        Something went wrong
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#9e9a94', maxWidth: '400px' }}>
                        {this.state.error.message}
                    </p>
                    <button
                        onClick={() => this.setState({ error: null })}
                        style={{
                            background: '#81b64c', color: '#fff', border: 'none',
                            borderRadius: '6px', padding: '10px 20px', fontSize: '0.9rem',
                            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                    >
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
