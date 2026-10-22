/**
 * Template Drafting Component - Debounce Utility
 */

/**
 * Creates a debounced function that delays invoking func until after wait
 * milliseconds have elapsed since the last time the debounced function was invoked.
 */
export const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
): {
    (...args: Parameters<T>): void;
    cancel: () => void;
    flush: () => void;
} => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;

    const debounced = (...args: Parameters<T>): void => {
        lastArgs = args;

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func(...args);
            timeoutId = null;
            lastArgs = null;
        }, wait);
    };

    debounced.cancel = (): void => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
            lastArgs = null;
        }
    };

    debounced.flush = (): void => {
        if (timeoutId !== null && lastArgs !== null) {
            clearTimeout(timeoutId);
            func(...lastArgs);
            timeoutId = null;
            lastArgs = null;
        }
    };

    return debounced;
};

/**
 * Creates a throttled function that only invokes func at most once
 * per every wait milliseconds.
 */
export const throttle = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
): ((...args: Parameters<T>) => void) => {
    let lastCall = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<T>): void => {
        const now = Date.now();

        if (now - lastCall >= wait) {
            lastCall = now;
            func(...args);
        } else if (timeoutId === null) {
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                func(...args);
                timeoutId = null;
            }, wait - (now - lastCall));
        }
    };
};
