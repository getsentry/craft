import { createSymlinks } from '../symlink';
import { withTempDir } from '../files';
import { promises as fsPromises } from 'fs';

import * as path from 'path';

describe('createSymlinks', () => {
  it.each([
    {
      _name: 'major version upgrade',
      oldVersion: '0.9.0',
      newVersion: '1.0.0',
      expectedSymlinks: ['1.json', '1.0.json', 'latest.json'],
    },
    {
      _name: 'minor version upgrade',
      oldVersion: '0.2.3',
      newVersion: '0.3.0',
      expectedSymlinks: ['0.json', '0.3.json', 'latest.json'],
    },
    {
      _name: 'path version upgrade',
      oldVersion: '0.2.3',
      newVersion: '0.2.4',
      expectedSymlinks: ['0.json', '0.2.json', 'latest.json'],
    },
    {
      _name: 'old version is undefined',
      oldVersion: undefined,
      newVersion: '1.2.3',
      expectedSymlinks: ['1.json', '1.2.json', 'latest.json'],
    },
    {
      _name: 'updating older major',
      oldVersion: '2.3.4',
      newVersion: '1.2.3',
      expectedSymlinks: ['1.2.json'],
    },
  ])('$_name', async ({ oldVersion, newVersion, expectedSymlinks }) => {
    await withTempDir(async tmpDir => {
      const versionFile = `${newVersion}.json`;
      const versionFilePath = path.join(tmpDir, versionFile);

      createSymlinks(versionFilePath, newVersion, oldVersion);

      // Check that there are no other files in the directory
      const filesInDir = await fsPromises.readdir(tmpDir);
      expect(filesInDir.sort()).toStrictEqual(expectedSymlinks.sort());

      for (const symlinkFile of filesInDir) {
        const symlinkFilePath = path.join(tmpDir, symlinkFile);

        // Make sure it's a symbolic link
        const fileStat = await fsPromises.lstat(symlinkFilePath);
        expect(fileStat.isSymbolicLink()).toBe(true);

        // Make sure it points to the right file
        const symlinkDestination = await fsPromises.readlink(symlinkFilePath);
        expect(symlinkDestination).toBe(versionFile);
      }
    });
  });
});
