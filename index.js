'use strict';

const axios = require('axios');
const assert = require('assert');
const axiosRetry = require('axios-retry');
const version = require('./package.json').version;

const setImmediate = global.setImmediate || process.nextTick.bind(process);
const noop = () => {};

class Analytics {

    /**
     * Creates the analytics object. ApiKey needs to be set by the user.
     *
     * @param apiKey
     * @param host
     */
    constructor(apiKey, host = 'https://api.mable.de/dev/v1/batch') {
        assert(apiKey, 'Please provide a valid API key.');

        this.apiKey = apiKey;
        this.host = host;
        this.queue = [];
        this.flushAfter = 10000; // defaults to 10 seconds
        this.flushed = false;
        this.maxQueueSize = 1024 * 1024; // defaults to 1MB
        this.axiosInstance = axios.create();

        axiosRetry(this.axiosInstance, {
            retries: 3,
            retryCondition: this.checkIfErrorIsRetryable,
            retryDelay: axiosRetry.exponentialDelay
        });
    }

    /**
     * Track an event for a given user.
     *
     * @param event The event to track
     * @param cb Callback
     */
    track(event = {}, cb) {
        this.addToQueue('track', event, cb);
        return this;
    }

    /**
     * Add event and callback to internal queue.
     *
     * @param type
     * @param event
     * @param cb
     */
    addToQueue(type, event, cb) {
        cb = cb || noop;

        event = Object.assign({}, event);
        event.context = Object.assign({
            library: {
                name: 'mable-ai-analytics',
                version,
                nodeVersion: process.versions.node
            }
        }, event.context);
        event.eventType = type;
        event.apiKey = this.apiKey;
        event.id = event.id || uuid();

        this.queue.push({event, cb});

        if (!this.flushed) {
            this.flushed = true;
            this.flush(cb);
            return;
        }

        if (this.queue.reduce((accumulatedSize, item) => accumulatedSize + JSON.stringify(item).length, 0) >= this.maxQueueSize) {
            this.flush(cb);
            return;
        }

        if (!this.intervalTimer) {
            this.intervalTimer = setTimeout(this.flush.bind(this, cb), this.flushAfter);
        }
    }

    /**
     * Flush the queue and send to the server.
     *
     * @param cb
     */
    flush(cb) {
        if (this.intervalTimer) {
            clearTimeout(this.intervalTimer);
            this.intervalTimer = null;
        }

        if (!this.queue.length) {
            setImmediate(cb);
            return Promise.resolve();
        }

        const items = this.queue.splice(0, 20);
        const callbacks = items.map(item => item.callback)
        const messages = items.map(item => item.message)

        const batchData = {
            data: messages,
            timestamp: new Date(),
            sentAt: new Date(),
        }

        const finish = err => {
            callbacks.forEach(cb => cb(err));
            cb(err, batchData);
        }

        const req = {
            headers: {
                "X-Mable-APIKey": this.apiKey
            }
        }

        return this.axiosInstance.post(this.host, batchData, req)
            .then(() => {
                finish()
                return Promise.resolve(batchData)
            })
            .catch(err => {
                if (err.response) {
                    const error = new Error(err.response.statusText)
                    finish(error)
                    throw error
                }

                finish(err)
                throw err
            })
    }

    checkIfErrorIsRetryable(error) {
        if (axiosRetry.isNetworkError(error)) {
            return true;
        }

        if (!error.response) {
            return false;
        }

        // Retry Server Errors (5xx).
        if (error.response.status >= 500 && error.response.status <= 599) {
            return true;
        }

        // Only retry if rate limited.
        return error.response.status === 429;
    }
}

module.exports = Analytics;
