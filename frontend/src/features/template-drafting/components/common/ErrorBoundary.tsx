/**
 * Template Drafting Component - Error Boundary
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Logger } from '../../utils/logger';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        Logger.error('REACT_ERROR_BOUNDARY', {
            error: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack
        });
    }

    handleRetry = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-state">
                    <p className="error-state__message">
                        Something went wrong. Please try again.
                    </p>
                    <button
                        className="error-state__button"
                        onClick={this.handleRetry}
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
