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

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
