import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import nock from 'nock';
import { beforeEach, expect, jest } from '@jest/globals';
import prettier from 'prettier';
import cheerio from 'cheerio';
import loadPage from '../src';

jest.setTimeout(30000);

nock.disableNetConnect();

const getFixturePath = (filename) => path.join('.', '__fixtures__', filename);
const readFile = (filename) => fs.readFile(filename, 'utf-8');
const formatHtml = (htmlString) => prettier.format(htmlString, { parser: 'html' });

let tempDir;

const realWriteFile = fs.writeFile;

beforeEach(async () => {
  jest.clearAllMocks();

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'));

  fs.writeFile = realWriteFile;
});

const base = 'https://ru.hexlet.io';

test('Loads the page.', async () => {
  const response = await readFile(getFixturePath('ru-hexlet-io-courses.html'));
  const expected = await readFile(getFixturePath('ru-hexlet-io-courses-expected.html'));
  const pathname = '/courses';

  nock(base)
    .get(pathname)
    .reply(200, response);

  const filepath = await loadPage(`${base}${pathname}`, tempDir);

  const actual = await readFile(filepath);

  expect(actual).toBe(formatHtml(expected));
});

test('Loads the pages and all its assets.', async () => {
  const resourceName = 'ru-hexlet-io-courses';
  const filesFolderName = `${resourceName}_files`;
  const page = await readFile(getFixturePath('page-with-assets.html'));
  const expected = await readFile(getFixturePath('page-with-assets-expected.html'));
  const pathname = '/courses';
  const assets = [
    { pathname: '/assets/professions/nodejs.png', file: 'nodejs.png', contentType: 'image/png' },
    { pathname: '/assets/application.css', file: 'application.css', contentType: 'text/css' },
    { pathname: '/packs/js/runtime.js', file: 'runtime.js', contentType: 'application/javascript' },
  ];

  nock(base)
    .get(pathname)
    .reply(200, page);

  assets.forEach((asset) => nock(base)
    .get(asset.pathname)
    .replyWithFile(200, getFixturePath(asset.file), {
      'Content-Type': asset.contentType,
    }));

  const filepath = await loadPage(`${base}${pathname}`, tempDir);

  const filesFolder = await fs.stat(path.join(tempDir, filesFolderName));

  expect(filesFolder.isDirectory()).toBeTruthy();

  const actual = await readFile(filepath);

  expect(formatHtml(actual)).toBe(formatHtml(expected));

  const $ = cheerio.load(actual);

  const images = $('img');

  const promises = images
    .map((idx, image) => {
      const src = $(image).attr('src');
      const imagePath = path.join(tempDir, src);

      return fs.access(path.resolve(imagePath));
    });

  await expect(Promise.all(promises)).resolves.toBeTruthy();
});

test('Throws an error if the page was not found.', async () => {
  const pathname = '/courses';
  const url = `${base}${pathname}`;

  nock(base)
    .get(pathname)
    .reply(404);

  await expect(loadPage(url, tempDir)).rejects.toThrow(`Request to the page ${url} failed with status code 404`);
});

test('Throws an error if there was no response from the server.', async () => {
  const pathname = '/courses';
  const url = `${base}${pathname}`;

  nock(base)
    .get(pathname)
    .reply(444);

  await expect(loadPage(url, tempDir)).rejects.toThrow(`Request to the page ${url} failed with status code 444`);
});

test('Throws an error if there was an error on the server during page loading.', async () => {
  const pathname = '/courses';
  const url = `${base}${pathname}`;

  nock(base)
    .get(pathname)
    .reply(500);

  await expect(loadPage(url, tempDir)).rejects.toThrow(`Request to the page ${url} failed with status code 500`);
});

test('Throws an error if the the resource was not found.', async () => {
  const page = await readFile(getFixturePath('page-with-assets.html'));
  const pathname = '/courses';
  const assets = [
    { pathname: '/assets/professions/nodejs.png', file: 'nodejs.png', contentType: 'image/png' },
    { pathname: '/assets/application.css', file: 'application.css', contentType: 'text/css' },
    { pathname: '/packs/js/runtime.js', file: 'runtime.js', contentType: 'application/javascript' },
  ];
  const url = `${base}${pathname}`;

  nock(base)
    .get(pathname)
    .reply(200, page);

  assets.forEach((asset) => {
    const status = asset.file === 'nodejs.png' ? 404 : 200;

    nock(base)
      .get(asset.pathname)
      .replyWithFile(status, getFixturePath(asset.file), {
        'Content-Type': asset.contentType,
      });
  });

  await expect(loadPage(url, tempDir)).rejects.toThrow(`Request to the resource ${base}/assets/professions/nodejs.png failed with status code 404`);
});

test('Throws an error if the there was an error during resource loading.', async () => {
  const page = await readFile(getFixturePath('page-with-assets.html'));
  const pathname = '/courses';
  const assets = [
    { pathname: '/assets/professions/nodejs.png', file: 'nodejs.png', contentType: 'image/png' },
    { pathname: '/assets/application.css', file: 'application.css', contentType: 'text/css' },
    { pathname: '/packs/js/runtime.js', file: 'runtime.js', contentType: 'application/javascript' },
  ];
  const url = `${base}${pathname}`;

  nock(base)
    .get(pathname)
    .reply(200, page);

  assets.forEach((asset) => {
    const status = asset.file === 'nodejs.png' ? 500 : 200;

    nock(base)
      .get(asset.pathname)
      .replyWithFile(status, getFixturePath(asset.file), {
        'Content-Type': asset.contentType,
      });
  });

  await expect(loadPage(url, tempDir)).rejects.toThrow(`Request to the resource ${base}/assets/professions/nodejs.png failed with status code 500`);
});

test('Throws an error if there was an error during saving loaded page.', async () => {
  fs.writeFile = jest.fn().mockImplementation(() => Promise.reject(new Error('Some error')));

  const response = await readFile(getFixturePath('ru-hexlet-io-courses.html'));
  const pathname = '/courses';

  nock(base)
    .get(pathname)
    .reply(200, response);

  await expect(loadPage(`${base}${pathname}`, tempDir)).rejects.toThrow('Error during saving the loaded page');
});

test('Throws an error if there was an error during saving loaded resource.', async () => {
  fs.writeFile = jest.fn().mockImplementation(() => Promise.reject(new Error('Some error')));

  const page = await readFile(getFixturePath('page-with-assets.html'));
  const pathname = '/courses';
  const assets = [
    { pathname: '/assets/professions/nodejs.png', file: 'nodejs.png', contentType: 'image/png' },
    { pathname: '/assets/application.css', file: 'application.css', contentType: 'text/css' },
    { pathname: '/packs/js/runtime.js', file: 'runtime.js', contentType: 'application/javascript' },
  ];

  nock(base)
    .get(pathname)
    .reply(200, page);

  assets.forEach((asset) => nock(base)
    .get(asset.pathname)
    .replyWithFile(200, getFixturePath(asset.file), {
      'Content-Type': asset.contentType,
    }));

  await expect(loadPage(`${base}${pathname}`, tempDir)).rejects.toThrow();
});

test('Throws an error if the dest folder does not exist.', async () => {
  const page = await readFile(getFixturePath('page-with-assets.html'));
  const pathname = '/courses';
  const assets = [
    { pathname: '/assets/professions/nodejs.png', file: 'nodejs.png', contentType: 'image/png' },
    { pathname: '/assets/application.css', file: 'application.css', contentType: 'text/css' },
    { pathname: '/packs/js/runtime.js', file: 'runtime.js', contentType: 'application/javascript' },
  ];

  nock(base)
    .get(pathname)
    .reply(200, page);

  assets.forEach((asset) => nock(base)
    .get(asset.pathname)
    .replyWithFile(200, getFixturePath(asset.file), {
      'Content-Type': asset.contentType,
    }));

  await expect(loadPage(`${base}${pathname}`, './some-non-existing-folder')).rejects.toThrow('Dest folder does not exist');
});