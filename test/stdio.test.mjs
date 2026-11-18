import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'eurokyb-mcp.mjs');

function runBridge(lines, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.write(lines.join('\n') + '\n');
    child.stdin.end();
  });
}

test('stdio bridge forwards JSON-RPC requests and wraps upstream HTTP failures', async () => {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.method === 'fail/http500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Error');
        return;
      }
      if (msg.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } }));
    });
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const { code, out, err } = await runBridge(
      [
        '{bad json',
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'fail/http500' }),
      ],
      { EUROKYB_MCP_URL: `http://127.0.0.1:${port}/mcp` }
    );
    assert.equal(code, 0, err);
    const parsed = out.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].error.code, -32700);
    assert.deepEqual(parsed[1], { jsonrpc: '2.0', id: 1, result: { echo: 'tools/list' } });
    assert.equal(parsed[2].id, 2);
    assert.equal(parsed[2].error.code, -32000);
    assert.match(parsed[2].error.message, /HTTP 500/);
  } finally {
    srv.close();
  }
});
