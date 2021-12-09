# Mable AI Analytics JS

Analytics library to send events to the mable server without having to deal with all the manual steps.

## Usage - Setup

    const Analytics = require('@mableai/analytics')

    const analytics = new Analytics(apiKey);

### Track Events

    analytics.track(event, cb);

### Identify Events

    analytics.identify(event, cb);

## Todos

* Give this README more love
* Add proper tests for the code and run them in CI
* Add GH Action for automated tests
