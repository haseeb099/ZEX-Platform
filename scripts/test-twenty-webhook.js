const crypto = require('crypto');
const http = require('http');

const tenantId = process.argv[2] || 'cmt4tqu4x0000196hl8gwqizv';
const secret =
  process.argv[3] || 'whsec_07fd81cbef78b8ffd3a5cad7dd92970cf51f59ced7936e47';

const payload = {
  targetUrl: `http://localhost:3002/webhooks/twenty/${tenantId}`,
  eventName: 'person.created',
  objectMetadata: { id: 'obj', nameSingular: 'person' },
  workspaceId: '4d0be501-90a1-4d55-a3ae-637bf628ec6e',
  webhookId: '483f6932-b5ee-4d3b-9bd9-278dde2220f5',
  eventDate: new Date().toISOString(),
  record: {
    id: 'webhook-test-person-1',
    name: { firstName: 'Webhook', lastName: 'Test' },
    jobTitle: 'VP of Sales',
  },
};

const jsonPayload = JSON.stringify(payload);
const timestamp = Date.now().toString();
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${timestamp}:${jsonPayload}`)
  .digest('hex');
const nonce = crypto.randomBytes(16).toString('hex');

const req = http.request(
  {
    hostname: 'localhost',
    port: 3002,
    path: `/webhooks/twenty/${tenantId}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonPayload),
      'X-Twenty-Webhook-Timestamp': timestamp,
      'X-Twenty-Webhook-Signature': signature,
      'X-Twenty-Webhook-Nonce': nonce,
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(body);
    });
  },
);

req.on('error', console.error);
req.write(jsonPayload);
req.end();
