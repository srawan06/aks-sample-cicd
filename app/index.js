const express = require('express');
const helmet = require('helmet');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers - fixes ZAP baseline scan findings:
// X-Content-Type-Options, X-Powered-By leak, CSP, Cross-Origin-Resource-Policy
app.use(helmet());
app.disable('x-etag'); // avoid unnecessary caching hints on dynamic responses

// helmet doesn't set these two by default - add explicitly
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/', (req, res) => {
  res.json({
    message: 'Hello from AKS!',
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || 'dev'
  });
});

// Liveness/readiness probe target
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// DEMO/LOAD-TESTING ONLY - deliberately burns CPU for `ms` milliseconds
// (default 1000, capped at 5000) so we can generate real, sustained CPU
// load to demonstrate the HorizontalPodAutoscaler.
//
// Disabled by default (ENABLE_BURN_ENDPOINT is not set in
// k8s/deployment.yaml) since an unauthenticated CPU-burn route is a real
// DoS vector if left reachable. To re-enable for a future demo, add
// `- name: ENABLE_BURN_ENDPOINT / value: "true"` to the container's env
// in k8s/deployment.yaml and redeploy - never enable this permanently.
if (process.env.ENABLE_BURN_ENDPOINT === 'true') {
  app.get('/burn', (req, res) => {
    const ms = Math.min(parseInt(req.query.ms, 10) || 1000, 5000);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // deliberately busy-loop to consume CPU
    }
    res.json({ burnedMs: ms });
  });
}

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});