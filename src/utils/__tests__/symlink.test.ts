import { createSymlinks } from '../symlink';
import { withTempDir } from '../files';
import { promises as fsPromises } from 'fs';

import * as path from 'path';
import * as fs from 'fs';

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
      _name: 'patch version upgrade',
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
      _name: 'updating older major (patch)',
      oldVersion: '2.3.4',
      newVersion: '1.2.3',
      expectedSymlinks: ['1.json', '1.2.json'],
    },
    {
      _name: 'updating older major (minor)',
      oldVersion: '2.3.4',
      newVersion: '1.3.0',
      expectedSymlinks: ['1.json', '1.3.json'],
    },
  ])('$_name', async ({ oldVersion, newVersion, expectedSymlinks }) =>
    withTempDir(async tmpDir => {
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
    }, true),
  );

  it('handles updating an old major version', async () =>
    withTempDir(async tmpDir => {
      // fill the directory with some "previous" versions and symlinks
      // (we also need to also the concrete version file to avoid broken symlinks)

      fs.writeFileSync(path.join(tmpDir, '1.0.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.0.0.json'), '1.0.0');

      fs.writeFileSync(path.join(tmpDir, '2.0.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '2.0.0.json'), '2.0.0', '1.0.0');

      // now update 1.x (minor)
      fs.writeFileSync(path.join(tmpDir, '1.5.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.5.0.json'), '1.5.0', '2.0.0');

      // now update a version in between 1.x and 1.5.x
      fs.writeFileSync(path.join(tmpDir, '1.2.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.2.0.json'), '1.2.0', '2.0.0');

      // now update 1.5.x (patch)
      fs.writeFileSync(path.join(tmpDir, '1.5.1.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.5.1.json'), '1.5.1', '2.0.0');

      const filesInDir = await fsPromises.readdir(tmpDir);
      expect(filesInDir.sort()).toStrictEqual(
        [
          '1.0.0.json',
          '1.2.0.json',
          '1.5.0.json',
          '1.5.1.json',
          '2.0.0.json',

          '1.json',
          '2.json',

          '1.0.json',
          '1.2.json',
          '1.5.json',
          '2.0.json',

          'latest.json',
        ].sort(),
      );

      const latestLink = await fsPromises.readlink(
        path.join(tmpDir, 'latest.json'),
      );
      const major1Link = await fsPromises.readlink(path.join(tmpDir, '1.json'));
      const major2Link = await fsPromises.readlink(path.join(tmpDir, '2.json'));
      const minor10Link = await fsPromises.readlink(
        path.join(tmpDir, '1.0.json'),
      );
      const minor12Link = await fsPromises.readlink(
        path.join(tmpDir, '1.2.json'),
      );
      const minor15Link = await fsPromises.readlink(
        path.join(tmpDir, '1.5.json'),
      );
      const minor20Link = await fsPromises.readlink(
        path.join(tmpDir, '2.0.json'),
      );

      expect(latestLink).toBe('2.0.0.json');

      expect(major1Link).toBe('1.5.1.json');
      expect(major2Link).toBe('2.0.0.json');

      expect(minor10Link).toBe('1.0.0.json');
      expect(minor12Link).toBe('1.2.0.json');
      expect(minor15Link).toBe('1.5.1.json');
      expect(minor20Link).toBe('2.0.0.json');
    }, true));

  it('handles updating a previous minor version on the same major', async () =>
    withTempDir(async tmpDir => {
      fs.writeFileSync(path.join(tmpDir, '1.0.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.0.0.json'), '1.0.0');

      fs.writeFileSync(path.join(tmpDir, '1.1.0.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.1.0.json'), '1.1.0', '1.0.0');

      fs.writeFileSync(path.join(tmpDir, '1.0.1.json'), 'x');
      createSymlinks(path.join(tmpDir, '1.0.1.json'), '1.0.1', '1.1.0');

      const filesInDir = await fsPromises.readdir(tmpDir);
      expect(filesInDir.sort()).toStrictEqual(
        [
          '1.0.0.json',
          '1.0.1.json',
          '1.1.0.json',

          '1.json',

          '1.0.json',
          '1.1.json',

          'latest.json',
        ].sort(),
      );

      const latestLink = await fsPromises.readlink(
        path.join(tmpDir, 'latest.json'),
      );
      const major1Link = await fsPromises.readlink(path.join(tmpDir, '1.json'));
      const minor10Link = await fsPromises.readlink(
        path.join(tmpDir, '1.0.json'),
      );
      const minor11Link = await fsPromises.readlink(
        path.join(tmpDir, '1.1.json'),
      );

      expect(latestLink).toBe('1.1.0.json');
      expect(major1Link).toBe('1.1.0.json');
      expect(minor10Link).toBe('1.0.1.json');
      expect(minor11Link).toBe('1.1.0.json');
    }, true));
});

// This is quite an edge case but nevertheless good to know it's covered:
it('handles updating a previous patch version on the same minor', async () =>
  withTempDir(async tmpDir => {
    fs.writeFileSync(path.join(tmpDir, '1.0.0.json'), 'x');
    createSymlinks(path.join(tmpDir, '1.0.0.json'), '1.0.0');

    fs.writeFileSync(path.join(tmpDir, '1.0.2.json'), 'x');
    createSymlinks(path.join(tmpDir, '1.0.2.json'), '1.0.2', '1.0.0');

    fs.writeFileSync(path.join(tmpDir, '1.0.1.json'), 'x');
    createSymlinks(path.join(tmpDir, '1.0.1.json'), '1.0.1', '1.0.2');

    const filesInDir = await fsPromises.readdir(tmpDir);
    expect(filesInDir.sort()).toStrictEqual(
      [
        '1.0.0.json',
        '1.0.1.json',
        '1.0.2.json',

        '1.json',

        '1.0.json',

        'latest.json',
      ].sort(),
    );

    const latestLink = await fsPromises.readlink(
      path.join(tmpDir, 'latest.json'),
    );
    const major1Link = await fsPromises.readlink(path.join(tmpDir, '1.json'));
    const minor10Link = await fsPromises.readlink(
      path.join(tmpDir, '1.0.json'),
    );

    expect(latestLink).toBe('1.0.2.json');
    expect(major1Link).toBe('1.0.2.json');
    expect(minor10Link).toBe('1.0.2.json');
  }));
