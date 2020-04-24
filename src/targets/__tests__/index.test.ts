import { getAllTargetNames, getTargetByName } from '..';
import { GithubTarget } from '../github';

describe('getTargetByName', () => {
  test('converts target name to class', async () => {
    expect(getTargetByName('github')).toBe(GithubTarget);
  });
});

describe('getAllTargetNames', () => {
  test('retrieves all target names', async () => {
    expect(getAllTargetNames()).toContain('github');
  });
});
