/**
 * Template Drafting Component - Structured Logger
 * All logs prefixed with [TEMPLATE_DRAFTING_UI]
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

interface LogContext {
    [key: string]: any;
}

interface LogEntry {
    level: LogLevel;
    action: string;
    context?: LogContext;
    timestamp: Date;
}

const formatLog = (level: LogLevel, action: string, context?: LogContext): void => {
    const timestamp = new Date().toISOString();
    const prefix = `[TEMPLATE_DRAFTING_UI][${level}]`;

    if (context && Object.keys(context).length > 0) {
        console.log(`${timestamp} ${prefix} ${action}`, context);
    } else {
        console.log(`${timestamp} ${prefix} ${action}`);
    }
};

/**
 * Structured logger for Template Drafting UI
 * All logs are prefixed for easy filtering
 */
export const Logger = {
    /**
     * Info level - general operation events
     */
    info: (action: string, context?: LogContext): void => {
        formatLog('INFO', action, context);
    },

    /**
     * Warn level - unexpected but recoverable situations
     */
    warn: (action: string, context?: LogContext): void => {
        formatLog('WARN', action, context);
        if (context) {
            console.warn(`[TEMPLATE_DRAFTING_UI][WARN] ${action}`, context);
        }
    },

    /**
     * Error level - failures and exceptions
     */
    error: (action: string, context?: LogContext): void => {
        formatLog('ERROR', action, context);
        if (context) {
            console.error(`[TEMPLATE_DRAFTING_UI][ERROR] ${action}`, context);
        }
    },

    /**
     * Audit level - user actions for tracking
     */
    audit: (action: string, context?: LogContext): void => {
        formatLog('AUDIT', action, context);
    },

    /**
     * Performance tracking
     */
    perf: (action: string, durationMs: number, context?: LogContext): void => {
        const enrichedContext = { ...context, durationMs };

        if (durationMs > 3000) {
            formatLog('WARN', `${action} (slow operation)`, enrichedContext);
        } else {
            formatLog('INFO', action, enrichedContext);
        }
    }
};

/**
 * Track performance of async operations
 */
export const trackPerformance = async <T>(
    label: string,
    operation: () => Promise<T>,
    warnThresholdMs: number = 3000
): Promise<T> => {
    const start = performance.now();

    try {
        const result = await operation();
        const duration = performance.now() - start;

        Logger.perf(label, duration);

        return result;
    } catch (error) {
        const duration = performance.now() - start;
        Logger.error(`${label} FAILED`, { duration, error: (error as Error).message });
        throw error;
    }
};
