const fs: any = jest.createMockFromModule('fs');

function readFileSync(input: any) {
  return input;
}

fs.readFileSync = readFileSync;

module.exports = fs;
