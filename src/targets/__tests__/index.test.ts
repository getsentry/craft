import { getAllTargetNames, getTargetByName } from '..';
import { GithubTarget } from '../github';

describe('getTargetByName', () => {
  test('converts target name to class', async () => {
    expect(getTargetByName('github')).toBe(GithubTarget);
  });
});

describe('getAllTargetNames', () => {
  test('converts target name to class', async () => {
    expect(getAllTargetNames()).toContain('github');
  });
});
