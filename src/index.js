import path from 'path';
import { promises as fs } from 'fs';
import axios from 'axios';
import cheerio from 'cheerio';
import prettier from 'prettier';
import Listr from 'listr';
import debug from 'debug';
import 'axios-debug-log';

const axiosInstance = axios.create({
  timeout: 3000,
});

const log = debug('page-loader');

const genResourceName = (url) => url.replace(/[^a-zA-Z0-9]/g, '-');

const sources = {
  img: 'src',
  link: 'href',
  script: 'src',
};

const getTagSourcePropertyName = (tag) => {
  const propertyName = sources[tag];

  if (!propertyName) throw new Error('Invalid tag.');

  return propertyName;
};

const isCanonicalLink = ($element) => $element[0].name === 'link' && $element.attr('rel') === 'canonical';

const isAlternateLink = ($element) => $element[0].name === 'link' && $element.attr('rel') === 'alternate';

const loadPage = (url, dest = process.cwd(), config = {}) => {
  const { isSpinnerVisible = false } = config;

  const pageLink = new URL(url);
  const base = `${pageLink.protocol}//${pageLink.hostname}`;

  const pageName = genResourceName(`${pageLink.hostname}${pageLink.pathname === '/' ? '' : pageLink.pathname}`);
  const loadedPageName = `${pageName}.html`;
  const loadedResourcesDirname = `${pageName}_files`;
  const loadedResourcesPath = path.join('tmp', loadedResourcesDirname);
  const loadedPagePath = path.join(dest, loadedPageName);

  const tasks = new Listr([]);

  const resourcesTasks = new Listr([], { concurrent: true });

  const fetchResource = (resourceUrl, resourceFilename) => {
    const request = new Promise((resolve, reject) => axiosInstance
      .get(resourceUrl.toString(), { responseType: 'arraybuffer' })
      .then((response) => resolve({ ...response, filename: resourceFilename }))
      .catch((error) => reject(error)));

    const task = {
      title: `Fetching ${resourceUrl} resource`,
      task: () => request,
    };

    resourcesTasks.add(task);

    return request;
  };

  const isLocalResource = (resourceUrl) => {
    if (resourceUrl.startsWith('/')) return true;

    const source = new URL(resourceUrl);

    return source.hostname === pageLink.hostname;
  };

  const processTag = ($element, propName) => {
    const resourceUrl = new URL($element.attr(propName), base);
    const resourcePath = path.parse(`${resourceUrl.hostname}${resourceUrl.pathname}`);
    const resourceName = genResourceName(`${resourcePath.dir}/${resourcePath.name}`);
    const ext = resourcePath.ext || '.html';
    const resourceFilename = `${resourceName}${ext}`;

    $element.attr(propName, `${loadedResourcesDirname}/${resourceFilename}`);

    return { resourceUrl, resourceFilename };
  };

  const tags = {
    img: ($element) => {
      const propName = getTagSourcePropertyName('img');
      const { resourceUrl, resourceFilename } = processTag($element, propName);

      return fetchResource(resourceUrl, resourceFilename);
    },
    link: ($element) => {
      const propName = getTagSourcePropertyName('link');
      const { resourceUrl, resourceFilename } = processTag($element, propName);

      if (isCanonicalLink($element)) return null;

      if (isAlternateLink($element)) return null;

      return fetchResource(resourceUrl, resourceFilename);
    },
    script: ($element) => {
      const propName = getTagSourcePropertyName('script');
      const { resourceUrl, resourceFilename } = processTag($element, propName);

      return fetchResource(resourceUrl, resourceFilename);
    },
  };

  const loadResources = ({ data }) => {
    const $ = cheerio.load(data);

    const elements = Array.from($('img, link, script[src]'));

    const requests = elements
      .map((element) => $(element))
      .filter(($element) => {
        const propertyName = getTagSourcePropertyName($element[0].name);
        const resourceUrl = $element.attr(propertyName);
        const result = isLocalResource(resourceUrl);

        return result;
      })
      .map(($element) => {
        const process = tags[$element[0].name];
        const request = process($element);

        return request;
      })
      .filter((request) => !!request);

    const htmlString = $.html();

    return Promise.all(requests)
      .catch((error) => {
        throw new Error(`Request to the resource ${error.response.config.url} failed with status code ${error.response.status}`);
      })
      .then((responses) => new Promise((resolve) => {
        // fs.access(loadedResourcesPath)
        //   .then(() => resolve(responses))
        //   .catch(() => {
            fs.mkdir(loadedResourcesPath)
              .then(() => resolve(responses))
              .catch((error) => {
                throw new Error(error);
              });
        //   });
      }))
      .then((responses) => {
        const promises = responses.map((response) => {
          const filepath = path.join(loadedResourcesPath, response.filename);
          const buffer = response.data;

          return fs
            .writeFile(filepath, buffer)
            .catch(() => {
              throw new Error(`Error during saving the loaded resource ${response.filename}`);
            });
        });

        return Promise.all(promises);
      })
      .then(() => ({ data: htmlString }));
  };

  log(`Fetching page: ${url}`);

  const promise = fs
    .access(dest)
    .catch(() => {
      throw new Error('Dest folder does not exist');
    })
    .then(() => {
      const request = axiosInstance
        .get(url)
        .catch((error) => {
          if (error.code === 'ECONNABORTED') {
            throw new Error(`A timeout happened on url ${url}`);
          }

          throw new Error(`Request to the page ${url} failed with status code ${error.response.status}`);
        });

      const task = {
        title: `Fetching page: ${url}`,
        task: () => request,
      };

      const resourcesTask = {
        title: 'Fetching resources',
        task: () => resourcesTasks,
      };

      tasks.add(task);
      tasks.add(resourcesTask);

      if (isSpinnerVisible) tasks.run();

      return request;
    })
    .then((response) => {
      log('Fetching resources');

      return response;
    })
    .then(loadResources)
    .then((data) => {
      log('Writing data to the file.');

      return data;
    })
    .then(({ data }) => fs
      .writeFile(loadedPagePath, prettier.format(data, { parser: 'html' }), 'utf-8')
      .catch(() => {
        throw new Error('Error during saving the loaded page');
      }))
    .then(() => loadedPagePath);

  return promise;
};

export default loadPage;