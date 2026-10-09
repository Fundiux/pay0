import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadConfig } from './config.mjs';
import { createLoggingWriter } from './logging.mjs';
import { createCanaryServer } from './http.mjs';
const require = createRequire(import.meta.url);
try {
  const config = loadConfig(process.env);
  const { createAuthorizationObservationPublisher } = require('../.build/publisher.cjs');
  // Stable per revision so operator retries exercise downstream deduplication.
  const id = 'canary_' + createHash('sha256').update(`PAY0-CANARY@1:${config.resource.revisionName}`).digest('hex');
  const publisher = createAuthorizationObservationPublisher({ enabled: config.mode !== 'DISABLED', resource: config.resource,
    write: createLoggingWriter(config), eventId: () => id });
  const server = createCanaryServer(config, publisher);
  server.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 4500).unref(); });
} catch { process.stderr.write('PUBLISHER_STARTUP_REJECTED\n'); process.exitCode = 1; }
