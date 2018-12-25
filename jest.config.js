module.exports = {
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['js', 'ts', 'json'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  globals: {
    'ts-jest': {
      tsConfig: './tsconfig.json',
    },
  },
};
