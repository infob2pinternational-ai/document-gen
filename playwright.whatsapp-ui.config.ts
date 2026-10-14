import {defineConfig} from '@playwright/test';
import isolated from './playwright.isolated-verification.config';
export default defineConfig({...isolated,testMatch:/(whatsapp-inbox-mobile|whatsapp-ui-drafts)\.spec\.ts/,
 outputDir:'test-results/whatsapp-ui',reporter:[['list'],['json',{outputFile:'playwright-report/whatsapp-ui.json'}]],
});
