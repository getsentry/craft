// tslint:disable-next-line: no-var-requires
const consola = require('consola');

const loggerModule: typeof consola = jest.genMockFromModule('../logger');

loggerModule.logger.withScope = function(): any {
  return this;
};

module.exports = loggerModule;
