const actualFs = jest.requireActual('fs');

module.exports = {
  ...actualFs,
  // Don't mock readFileSync - let it use the real implementation
  // Tests that need to mock it can do so explicitly
  existsSync: jest.fn(() => true),
};
