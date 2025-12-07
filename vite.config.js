import { defineConfig } from 'vite';

export default defineConfig({
    root: 'demo',
    server: {
        port: 3000,
        open: true,
        allowedHosts: ['241284034b20.ngrok-free.app']
    }
});
