import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  plugins: [
    {
      name: 'watch-public-assets',
      configureServer(server) {
        // Watch the public directory (models, textures, etc.) for changes
        const publicDir = path.resolve('public');
        server.watcher.add(publicDir);

        const reloadBrowser = (filePath) => {
          console.log(`[vite] Asset changed in public: ${filePath} -> reloading browser`);
          server.ws.send({
            type: 'full-reload',
            path: '*'
          });
        };

        server.watcher.on('change', (file) => {
          if (file.includes('public')) reloadBrowser(file);
        });
        server.watcher.on('add', (file) => {
          if (file.includes('public')) reloadBrowser(file);
        });

        // Disable caching for 3D model files during development
        server.middlewares.use((req, res, next) => {
          if (req.url && (req.url.includes('/models/') || req.url.includes('.fbx') || req.url.includes('.gltf') || req.url.includes('.glb'))) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
          next();
        });
      }
    },
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
