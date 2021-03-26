install:
	npm install
publish:
	npm publish --dry-run
page-loader:
	node bin/pageLoader.js
test:
	npm test
test-coverage:
	npm test -- --coverage --coverageProvider=v8
lint:
	npx eslint .