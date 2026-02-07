import { getAllTargetNames, getTargetByName } from '..';
import { GitHubTarget } from '../github';

describe('getTargetByName', () => {
  test('converts target name to class', () => {
    expect(getTargetByName('github')).toBe(GitHubTarget);
  });
});

describe('getAllTargetNames', () => {
  test('retrieves all target names', () => {
    expect(getAllTargetNames()).toContain('github');
  });
});
