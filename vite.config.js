import { defineConfig } from 'vite';
import dns from 'dns';

dns.setDefaultResultOrder('verbatim');

export default defineConfig(({ command }) => {
  return {
    server: {
      port: 3000
    },
    base: command === 'serve' ? '/' : './'
  };
});
