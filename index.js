'use strict';

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const AUTH_PATH = path.join(process.cwd(), '.auth', 'sysAdmin.json');
const TEST_FILES_PATH = path.join(process.cwd(), 'testFiles');
const RECORD_PATH = `${process.env.CONTENT_RECORD_PATH}/Edit`;
const SAVE_ATTACHMENTS_PATH = `${process.env.CONTENT_RECORD_PATH}/SaveAttachments`;

await login();
const timings = await attachFiles();
writeToCsv(timings);

/**
 * @typedef {Object} Timing
 * @property {string} timestamp - The timestamp of the request
 * @property {string} instance - The instance URL
 * @property {string} fileName - The name of the file that was attached
 * @property {number} requestTimeInSeconds - The time in seconds that the request took
 */

/**
 * Write the timings to a CSV file
 * @param {Timing[]} timings - The timings to write to the CSV file
 * @returns {void}
 */
function writeToCsv(timings) {
  const resultsPath = path.join(process.cwd(), 'results');

  if (fs.existsSync(resultsPath) === false) {
    fs.mkdirSync(resultsPath);
  }

  const csv =
    'timestamp,instance,fileName,requestTimeInSeconds\n' +
    timings.map(timingToCsv).join('\n');

  fs.writeFileSync(path.join(resultsPath, 'timings.csv'), csv);
}

/**
 * Convert a timing to a CSV string
 * @param {Timing} timing - The timing to convert
 * @returns {string} - The timing as a CSV string
 */
function timingToCsv(timing) {
  const requestTime = timing.requestTimeInSeconds.toFixed(4);
  return `${timing.timestamp},${timing.instance},${timing.fileName},${requestTime}`;
}

/**
 * Attach files to a record and return the timings
 * @param {number} [numOfTimings=1] - The number of timings to take for each file
 * @returns {Promise<Timing[]>} - The timings for each file
 */
async function attachFiles(numOfTimings = 1) {
  const timings = [];
  const browser = await chromium.launch();

  const context = await browser.newContext({
    storageState: AUTH_PATH,
    baseURL: process.env.INSTANCE_URL,
  });

  const page = await context.newPage();

  page.on('requestfinished', async r => {
    if (r.url().includes(SAVE_ATTACHMENTS_PATH)) {
      const response = await r.response();
      const body = await response.json();
      const fileName = body.data[0].fileName.segments[0].text;
      const timing = r.timing();
      const requestTimeInSeconds =
        (timing.responseEnd - timing.requestStart) / 1000;
      console.log(
        `${fileName} took ${requestTimeInSeconds.toFixed(4)} seconds to upload`
      );
      timings.push({
        fileName,
        requestTimeInSeconds,
        instance: process.env.INSTANCE_URL,
        timestamp: new Date(timing.startTime).toISOString(),
      });
    }
  });

  await page.goto(RECORD_PATH);

  const files = fs.readdirSync(TEST_FILES_PATH);

  for (const file of files) {
    for (let i = 0; i < numOfTimings; i++) {
      const fileChooserPromise = page.waitForEvent('filechooser');
      const addFileResponse = page.waitForResponse(
        /\/Content\/(\d+\/)?\d+\/SaveAttachments/
      );

      await page.getByText('Add Attachment').click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(path.join(TEST_FILES_PATH, file));
      await addFileResponse;

      const saveRecordResponse = page.waitForResponse(r => {
        return r.url().includes(RECORD_PATH) && r.request().method() === 'POST';
      });
      await page.getByText('Save Record').click();
      await saveRecordResponse;
    }
  }

  await browser.close();

  return timings;
}

/**
 * Login to the instance and save the auth state
 * @returns {Promise<void>}
 */
async function login() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: process.env.INSTANCE_URL,
  });

  const page = await context.newPage();

  await page.goto('/Public/Login');

  await page.getByPlaceholder('Username').fill(process.env.SYS_ADMIN_USERNAME);
  await page.getByPlaceholder('Password').fill(process.env.PASSWORD);
  await page.getByText('Login').click();

  await page.waitForURL(/\/Dashboard/);
  await page.context().storageState({ path: AUTH_PATH });

  await browser.close();
}
