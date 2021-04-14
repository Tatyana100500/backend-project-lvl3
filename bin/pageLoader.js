#!/usr/bin/env node

import commander from 'commander';
import loadPage from '../src/index.js';

const { program } = commander;

program
  .version('1.0.0')
  .description('Loads the page and it resources.')
  .arguments('<pageUrl>')
  .option('-o, --output [dir]', 'output dir', process.cwd())
  .action((pageUrl, options) => loadPage(pageUrl, options.output, { isSpinnerVisible: true })
    .then((filepath) => console.log(filepath))
    .catch((error) => {
      console.error(error);

      process.exitCode = 1;
    }));

program.parse();