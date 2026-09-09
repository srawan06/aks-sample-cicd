const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

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
// load to demonstrate the HorizontalPodAutoscaler. Not something a real
// production app would expose.
app.get('/burn', (req, res) => {
  const ms = Math.min(parseInt(req.query.ms, 10) || 1000, 5000);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // deliberately busy-loop to consume CPU
  }
  res.json({ burnedMs: ms });
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});