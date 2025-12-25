/**
 * Enhanced Error Handling Utility
 * Provides comprehensive error handling and logging
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ErrorCategory {
  NETWORK = 'network',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  RUNTIME = 'runtime',
  EXTERNAL_API = 'external_api',
  DATABASE = 'database',
  FILE_SYSTEM = 'file_system',
  COGNITIVE = 'cognitive',
}

export interface ErrorContext {
  userId?: string;
  sessionId?: string;
  action?: string;
  component?: string;
  metadata?: Record<string, unknown>;
}

export interface EnhancedError {
  id: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: number;
  context: ErrorContext;
  stack?: string;
  originalError?: Error;
  recoverable: boolean;
  suggestions?: string[];
}

class ErrorHandler {
  private errorLog: EnhancedError[] = [];
  private maxLogSize = 100;

  /**
   * Handle an error with enhanced context and categorization
   */
  handle(
    error: Error | string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context: ErrorContext = {},
    suggestions: string[] = [],
  ): EnhancedError {
    const enhancedError: EnhancedError = {
      id: this.generateErrorId(),
      message: typeof error === 'string' ? error : error.message,
      category,
      severity,
      timestamp: Date.now(),
      context,
      stack: typeof error === 'object' ? error.stack : undefined,
      originalError: typeof error === 'object' ? error : undefined,
      recoverable: this.isRecoverable(category, severity),
      suggestions,
    };

    this.logError(enhancedError);
    this.notifyIfCritical(enhancedError);

    return enhancedError;
  }

  /**
   * Handle network errors specifically
   */
  handleNetworkError(
    error: Error,
    context: ErrorContext = {},
  ): EnhancedError {
    const suggestions = [
      'Check your internet connection',
      'Verify the API endpoint is accessible',
      'Try again in a few moments',
    ];

    return this.handle(
      error,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      context,
      suggestions,
    );
  }

  /**
   * Handle validation errors
   */
  handleValidationError(
    message: string,
    field?: string,
    context: ErrorContext = {},
  ): EnhancedError {
    const enhancedContext = {
      ...context,
      field,
    };

    return this.handle(
      message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      enhancedContext,
      ['Please check the input and try again'],
    );
  }

  /**
   * Handle cognitive system errors
   */
  handleCognitiveError(
    error: Error,
    agentType?: string,
    context: ErrorContext = {},
  ): EnhancedError {
    const enhancedContext = {
      ...context,
      agentType,
    };

    const suggestions = [
      'The cognitive system encountered an issue',
      'Falling back to standard processing',
      'Some advanced features may be temporarily unavailable',
    ];

    return this.handle(
      error,
      ErrorCategory.COGNITIVE,
      ErrorSeverity.MEDIUM,
      enhancedContext,
      suggestions,
    );
  }

  /**
   * Get error history
   */
  getErrorLog(): EnhancedError[] {
    return [...this.errorLog];
  }

  /**
   * Get errors by category
   */
  getErrorsByCategory(category: ErrorCategory): EnhancedError[] {
    return this.errorLog.filter((error) => error.category === category);
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(severity: ErrorSeverity): EnhancedError[] {
    return this.errorLog.filter((error) => error.severity === severity);
  }

  /**
   * Clear error log
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Export errors for debugging
   */
  exportErrors(): string {
    return JSON.stringify(this.errorLog, null, 2);
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isRecoverable(
    category: ErrorCategory,
    severity: ErrorSeverity,
  ): boolean {
    if (severity === ErrorSeverity.CRITICAL) {
      return false;
    }

    const recoverableCategories = [
      ErrorCategory.NETWORK,
      ErrorCategory.VALIDATION,
      ErrorCategory.COGNITIVE,
    ];

    return recoverableCategories.includes(category);
  }

  private logError(error: EnhancedError): void {
    // Add to error log
    this.errorLog.unshift(error);

    // Maintain max log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(0, this.maxLogSize);
    }

    // Console logging based on severity
    const logMethod = this.getLogMethod(error.severity);
    logMethod(
      `[${error.category}] ${error.message}`,
      {
        id: error.id,
        context: error.context,
        suggestions: error.suggestions,
      },
    );
  }

  private getLogMethod(severity: ErrorSeverity): typeof console.log {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        return console.error.bind(console);
      case ErrorSeverity.MEDIUM:
        return console.warn.bind(console);
      case ErrorSeverity.LOW:
      default:
        return console.log.bind(console);
    }
  }

  private notifyIfCritical(error: EnhancedError): void {
    if (error.severity === ErrorSeverity.CRITICAL) {
      // In a production environment, this would send to error tracking service
      console.error('CRITICAL ERROR:', error);
      
      // Could trigger alerts, notifications, etc.
      this.triggerCriticalErrorHandling(error);
    }
  }

  private triggerCriticalErrorHandling(error: EnhancedError): void {
    // Placeholder for critical error handling
    // In production, this might:
    // - Send to error tracking service (Sentry, Rollbar, etc.)
    // - Trigger alerts to development team
    // - Attempt automatic recovery procedures
    // - Save state for debugging
    console.error('Critical error handling triggered:', error.id);
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

// Export convenience functions
export const handleError = errorHandler.handle.bind(errorHandler);
export const handleNetworkError = errorHandler.handleNetworkError.bind(errorHandler);
export const handleValidationError = errorHandler.handleValidationError.bind(errorHandler);
export const handleCognitiveError = errorHandler.handleCognitiveError.bind(errorHandler);
