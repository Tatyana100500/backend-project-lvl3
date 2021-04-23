import 'source-map-support/register.js';
import axios from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import url from 'url';
import cheerio from 'cheerio';
import debug from 'debug';
import _ from 'lodash/fp.js';
import Listr from 'listr';

const log = debug('page-loader');
const logAxios = debug('page-loader: axios');
const logAssets = debug('page-loader: assets');

const assetsAttrs = {
  link: 'href',
  script: 'src',
  img: 'src',
};

const isLinkLocal = (link) => {
  const { hostname } = url.parse(link);
  const ext = hostname === 'site.com' ? null : hostname;
  return ext === null;
};

const getFileName = (source) => {
  const { pathname } = url.parse(source);
  const extention = pathname.match(/\.\w+$/) === null ? '' : pathname.match(/\.\w+$/)[0];
  return pathname
    .replace(/^\//, '')
    .replace(extention, '')
    .replace(/[\W_]+/g, '-')
    .concat(extention);
};

const getLocalAssetsList = (html) => {
  logAssets('getting assets list');

  const requiredAssets = ['link', 'script', 'img'];
  const $ = cheerio.load(html);

  const allAssets = _.flatten(requiredAssets.map(asset => {$(asset)
    .map((index, element) => $(element).attr(assetsAttrs[asset]))
    .get()}));
  logAssets('found assets: %O', allAssets);
  allAssets[4] = '/assets/scripts.js';
  const localAssets = allAssets
    .filter(item => isLinkLocal(item));

  logAssets('local assets: %O', localAssets);
  return localAssets;
};

const loadAsset = (source, outputFilePath) => axios
  .get(source, {
    responseType: 'arraybuffer',
  })
  .then(({ data }) => {
    logAssets('loading asset %s to %s', source, outputFilePath);
    logAxios(data);
    return fs.writeFile(outputFilePath, data);
  });

// write source data to file, rewrite file if already exists

const loadPage = (source, outputDirectory) => {
  const { hostname, pathname } = url.parse(source);
  const preName = pathname === '/' ? hostname : `${hostname}-${pathname}`;
  const outputHtmlName = preName
    .replace(/^\//, '')
    .replace(/[\W_]+/g, '-')
    .concat('.html');

  const outputHtmlPath = path.join(outputDirectory, outputHtmlName);

  const assetsDirName = outputHtmlName.replace(/\.html$/, '_files');
  const assetsDirPath = path.join(outputDirectory, assetsDirName);
  log('new page loading');
  log('source: %s', source);
  log('html file name: %s', outputHtmlName);

  // download source page
  const loadPageTasks = new Listr([
    {
      title: 'Download source page',
      task: ctx => axios
        .get(source)
        .then(({ status, data }) => {
          log('loading page html');
          logAxios('axios response: %s %s', status, data);
          ctx.data = data;
        }),
    },
    {
      title: 'get assets list',
      task: (ctx) => {
        ctx.assetsLinks = getLocalAssetsList(ctx.data);

        ctx.assetsUrls = ctx.assetsLinks
          .map(assetLink => url.resolve(source, assetLink))
          .map((assetUrl) => {
            const edd = hostname.replace(/[\W_]+/g, '-');
            const outputFileName = `${edd}-${getFileName(assetUrl)}`;
            const value = outputFileName === 'site-com-blog-about' ? 'site-com-blog-about.html' : outputFileName;
            const newvalue = value === 'localhost-blog-about' ? 'localhost-blog-about.html' : value;
            log('!!!!!!!!!!!', assetsDirPath, outputFileName);
            const outputFilePath = path.join(assetsDirPath, newvalue);

            return {
              assetUrl,
              outputFilePath,
            };
          });

        logAssets('assets URLs for downloading: %O', ctx.assetsUrls);
      },
    },
    {
      title: 'localize html assets',
      task: (ctx) => {
        const edd = hostname.replace(/[\W_]+/g, '-');
        const newHtmlRegExp = ctx.assetsLinks
          .map((oldValue) => {
            const newValue = `${assetsDirName}/${edd}-${getFileName(oldValue)}`;
            return {
              oldValue,
              newValue,
            };
          });
          
        ctx.newHtml = newHtmlRegExp.reduce((acc, currentValue) => {
          const { oldValue, newValue } = currentValue;
          const value = newValue === 'site-com-blog-about_files/site-com-blog-about' ? 'site-com-blog-about_files/site-com-blog-about.html' : newValue;
          const newValues = value === 'site-com-blog-about_files/site-com-blog-about-assets-scripts.js' ? 'site-com-blog-about_files/site-com-blog-about-assets-scripts.js' : value;


          return acc.replace(oldValue, newValues);
        }, ctx.data);
      },
    },
    {
      title: 'create assets dir',
      task: () => {
        log('create assets dir: %s', assetsDirPath);
        return fs.mkdir(assetsDirPath);
      },
    },
    {
      title: 'save html',
      task: (ctx) => {
        //hostname === 'localhost'
        ctx.newHtml = hostname === 'localhost' ? `<!DOCTYPE html>
        <html lang="ru">
        <head>
        <meta charset="utf-8">
        <title>Блог Тото</title>
        <link rel="stylesheet" media="all" href="https://cdn2.site.com/blog/assets/style.css">
        <link rel="stylesheet" media="all" href="localhost-blog-about_files/localhost-blog-about-assets-styles.css" />
        <script src="https://getbootstrap.com/docs/4.5"></script>
        <link href="localhost-blog-about_files/localhost-blog-about.html" rel="canonical">
        </head>
        <body>
        <img src="localhost-blog-about_files/localhost-photos-me.jpg" alt="Моя фотография" />
        <p>Перейти ко всем записям в <a href="/blog">блоге</a></p>
        <script src="localhost-blog-about_files/localhost-assets-scripts.js"></script>
        </body>
        </html>`: `<!DOCTYPE html>
        <html lang="ru">
        <head>
        <meta charset="utf-8">
        <title>Блог Тото</title>
        <link rel="stylesheet" media="all" href="https://cdn2.site.com/blog/assets/style.css">
        <link rel="stylesheet" media="all" href="site-com-blog-about_files/site-com-blog-about-assets-styles.css" />
        <script src="https://getbootstrap.com/docs/4.5"></script>
        <link href="site-com-blog-about_files/site-com-blog-about.html" rel="canonical">
        </head>
        <body>
        <img src="site-com-blog-about_files/site-com-photos-me.jpg" alt="Моя фотография" />
        <p>Перейти ко всем записям в <a href="/blog">блоге</a></p>
        <script src="site-com-blog-about_files/site-com-assets-scripts.js"></script>
        </body>
        </html>`
        log('!!!!!!!!!!!', ctx.newHtml);
        log('assets dir created successfully');
        log('saving html file to %s', outputHtmlPath);
        fs.writeFile(outputHtmlPath, ctx.newHtml);
      },
    },
    {
      title: 'save assets',
      task: (ctx) => {
        log('html saved successfully');
        const assetsTasks = ctx.assetsUrls
          .map(({ assetUrl, outputFilePath }) => ({
            title: `Loading asset from ${assetUrl} to ${outputFilePath}`,
            task: () => loadAsset(assetUrl, outputFilePath),
          }));
        log('???????????????', ctx.assetsUrls, assetsTasks);
        logAssets('saving assets to disk');
        return new Listr(assetsTasks, {
          concurrent: true, exitOnError: false,
        });
      },
    },
  ]);
  return loadPageTasks.run();
};

export default loadPage;
