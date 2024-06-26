'use strict';

const axios = require('axios');
const assert = require('assert');
const axiosRetry = require('axios-retry');
const uuid = require('uuid');
const Validator = require('jsonschema').Validator;
const version = require('./package.json').version;

const eventSchema = require('./schemas/event.schema.json');
const identifySchema = require('./schemas/identify.schema.json');

var v = new Validator();
const setImmediate = global.setImmediate || process.nextTick.bind(process);
const noop = () => {
};

class Analytics {

    /**
     * Creates the analytics object. ApiKey needs to be set by the user.
     *
     * @param apiKey
     * @param env
     * @param host
     */
    constructor(apiKey, env = 'production', host = null) {
        assert(apiKey, 'Please provide a valid API key.');

        this.defaultHost = (env == 'production')
            ? 'https://ingestion.mable.ai/batch'
            : 'https://ingestion.dev.mable.ai/batch';

        this.apiKey = apiKey;
        this.host = host || this.defaultHost;
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
     * Identify event for a given user.
     *
     * @param event The identify data
     * @param cb Callback
     */
    identify(event = {}, cb) {
        this.addToQueue('identify', event, cb);
        return this;
    }

    /**
     * Track page view events.
     *
     * @param event The page_view data.
     * @param cb Callback
     */
    pageview(event = {}, cb) {
        this.addToQueue('page_view', event, cb);
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
        event.id = event.id || uuid.v4();

        if (type === 'identify') {
            this.validateIdentify(event, cb);
        }

        if (type === 'track' || type === 'page_view') {            
            event.anonymousId = event.anonymousId || '';
            event.sessionId = event.sessionId || uuid.v4();
            event.shopping_data = Object.keys(event?.shopping_data  || {}).length ? event.shopping_data : null; if (!event.shopping_data) delete event.shopping_data;
            event.customerData = Object.keys(event.customerData || {}).length ? event.customerData : null; if (!event.customerData) delete event.customerData;
    
            this.validateEvent(event, cb);
        }

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
     * Validate the event instance.
     * 
     * @param event
     * @param cb
     * @returns {void}
    **/
    validateEvent(event, cb) {
        try {
            v.validate(event, eventSchema, {throwFirst: true});
        } catch (err) {
            cb(err.errors);
            throw err;
        }
    }

    /**
     * Validate the identify instance.
     * 
     * @param identifyEvent
     * @param cb
     * @returns {void}
    **/
     validateIdentify(identifyEvent, cb) {
        try {
            v.validate(identifyEvent, identifySchema, {throwFirst: true});
        } catch (err) {
            cb(err.errors);
            throw err;
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
        const callbacks = items.map(item => item.cb);
        const messages = items.map(item => item.event);

        const batchData = {
            data: messages,
            timestamp: new Date(),
            sentAt: new Date()
        };

        const finish = err => {
            callbacks.forEach(cb => cb(err));
            cb(err, batchData);
        };

        const req = {
            headers: {
                'X-Mable-APIKey': this.apiKey
            }
        };

        return this.axiosInstance.post(this.host, batchData, req)
            .then(() => {
                finish();
                return Promise.resolve(batchData);
            })
            .catch(err => {
                // DO not log just throw error
                // console.log('Error in sending events:', err);
                if (err.response) {
                    const error = new Error(err.response.statusText);
                    finish(error);
                    throw error;
                }

                finish(err);
                throw err;
            });
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
