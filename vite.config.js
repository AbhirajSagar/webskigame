import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  plugins: [
    {
      name: 'log-collector',
      configureServer(server) {
        server.middlewares.use('/__log', (req, res) => {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              fs.appendFileSync('D:/Projects/webskigame/browser.log', `[${new Date().toISOString()}] ${body}\n`);
            } catch (err) {
              console.error(err);
            }
            res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('ok');
          });
        });
      }
    }
  ]
});
