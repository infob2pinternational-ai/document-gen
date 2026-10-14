import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
 ...base,
 outputDir:'test-results/docker-free-20261012',
 use:{...base.use,baseURL:'http://127.0.0.1:5193/billing/',serviceWorkers:'block',
  proxy:{server:'http://127.0.0.1:5195',bypass:'localhost,127.0.0.1'}},
 webServer:{command:'node verification/browser-local-server.mjs',url:'http://127.0.0.1:5193/billing/',reuseExistingServer:false,timeout:120000},
 reporter:[['list'],['json',{outputFile:'playwright-report/docker-free-20261012.json'}]],
});
