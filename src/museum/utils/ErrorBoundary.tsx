import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  fallback: ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
  children?: ReactNode
}

/** Contains failures (missing image/model, bad asset) to the component that caused them. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') console.warn('[museum] contained error:', error.message)
    this.props.onError?.(error, info)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
