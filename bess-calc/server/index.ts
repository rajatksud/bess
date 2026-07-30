import { createApp, DEFAULT_STATIC_DIR } from './app';
import { logger } from './lib/logger';

const port = Number(process.env.PORT ?? 8080);

const app = createApp({ staticDir: DEFAULT_STATIC_DIR });

app.listen(port, () => {
  logger.info('server_started', { port });
});
