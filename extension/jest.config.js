export default {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.js'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@/i18n$': '<rootDir>/tests/mocks/i18n.js',
    '^react-i18next$': '<rootDir>/tests/mocks/react-i18next.js',
    '^webextension-polyfill$': '<rootDir>/tests/mocks/webextension-polyfill.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/dist/'],
  moduleFileExtensions: ['js', 'ts', 'tsx', 'json'],
};