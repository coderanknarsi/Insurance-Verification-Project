const http = require('http');

// First check health
const healthReq = http.get('http://localhost:8091/health', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HEALTH:', data);
    // If healthy, send test verification request
    sendTestRequest();
  });
});
healthReq.on('error', (e) => {
  console.log('ENGINE NOT RUNNING:', e.message);
  process.exit(1);
});

function sendTestRequest() {
  const payload = JSON.stringify({
    carrier: 'progressive',
    vin: '1GTR1VE04CZ348426',
    policyNumber: '872178941',
    credentials: {
      username: 'autoLT',
      password: 'Vikings2!'
    }
  });

  const options = {
    hostname: 'localhost',
    port: 8091,
    path: '/verify-test',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Sending verification request...');
  console.log('Payload:', JSON.stringify({ carrier: 'progressive', vin: '1GTR1VE04CZ348426', policyNumber: '872178941' }));

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      try {
        const parsed = JSON.parse(data);
        console.log('RESPONSE:', JSON.stringify(parsed, null, 2));
      } catch {
        console.log('RAW RESPONSE:', data);
      }
    });
  });

  req.on('error', (e) => {
    console.log('REQUEST ERROR:', e.message);
  });

  // Set a 5 minute timeout for the verification (Playwright automation takes time)
  req.setTimeout(300000);

  req.write(payload);
  req.end();
}
