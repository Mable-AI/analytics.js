export declare class Analytics {
    constructor(apiKey: any, host?: string);
    /**
     * Track an event for a given user.
     *
     * @param event The event to track
     * @param cb Callback
     */
    track(event: {}, cb: any): void;
    /**
     * Identify event for a given user.
     *
     * @param event The identify data
     * @param cb Callback
     */
    identify(event: {}, cb: any): void;
}

export default Analytics;
