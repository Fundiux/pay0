import { createRequire } from 'node:module';
import { loadConfig, createImmutableCanaryPublisher } from './config.mjs';
import { createLoggingWriter } from './logging.mjs';
import { createCanaryServer } from './http.mjs';
const require = createRequire(import.meta.url);
try {
  const config = loadConfig(process.env);
  const { createAuthorizationObservationPublisher } = require('../.build/publisher.cjs');
  const publisher = createImmutableCanaryPublisher(config, createAuthorizationObservationPublisher, createLoggingWriter(config));
  const server = createCanaryServer(config, publisher);
  server.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 4500).unref(); });
} catch { process.stderr.write('PUBLISHER_STARTUP_REJECTED\n'); process.exitCode = 1; }
